//! PTY 起動・非同期 I/O の低レベルプリミティブ（Python 側 `api/terminal_pty.py` の移植）。
//!
//! `nix::pty::forkpty`（glibc の `forkpty(3)` 相当 = openpty + fork + login_tty を
//! 1ステップで行う）を使い、CPython の `os.forkpty()` と同じ土台に乗る。fork 後の
//! 子プロセスは execve 呼び出しまで async-signal-safe な操作（syscall のみ）に
//! 限定しなければならない（マルチスレッドプロセスの fork 直後、他スレッドが保持
//! していたロック — アロケータ含む — は子に引き継がれず、確保しようとした時点で
//! 永久にブロックしうるため）。argv/envp の `CString` 化・`PATH` 探索は必ず fork
//! **前**に完了させ、子プロセスの分岐では既に用意済みのポインタで `execve` する
//! だけにする（Python `os.execvpe` は内部で PATH 探索してから `execve` する実装の
//! ため、この手順は Python と同じ意味論になる）。

use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};

use nix::pty::{ForkptyResult, Winsize};
use nix::unistd::Pid;

/// 子プロセスへ渡す実行環境（Python `attach_tmux_session` の env dict に対応）。
#[derive(Debug)]
pub struct ExecSpec {
    program_path: CString,
    argv: Vec<CString>,
    envp: Vec<CString>,
}

impl ExecSpec {
    /// `program` を `path_env`（"KEY1=v1:KEY2=v2..." 形式ではなく素の PATH 値）で
    /// 探索し、フルパスへ解決してから組み立てる（Python `os.execvpe` の PATH 探索
    /// 相当）。見つからなければ `ErrorKind::NotFound`。
    pub fn resolve(program: &str, args: &[&str], env: &[(&str, &str)]) -> io::Result<Self> {
        let path_env = env
            .iter()
            .find(|(k, _)| *k == "PATH")
            .map(|(_, v)| *v)
            .unwrap_or("/usr/bin:/bin");
        let program_path = resolve_in_path(program, path_env).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("{program}: not found in PATH"),
            )
        })?;
        let argv = std::iter::once(program)
            .chain(args.iter().copied())
            .map(|s| CString::new(s).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e)))
            .collect::<io::Result<Vec<_>>>()?;
        let envp = env
            .iter()
            .map(|(k, v)| {
                CString::new(format!("{k}={v}"))
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
            })
            .collect::<io::Result<Vec<_>>>()?;
        Ok(Self {
            program_path: CString::new(program_path)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?,
            argv,
            envp,
        })
    }
}

fn resolve_in_path(program: &str, path_env: &str) -> Option<String> {
    if program.contains('/') {
        return std::path::Path::new(program)
            .is_file()
            .then(|| program.to_string());
    }
    for dir in path_env.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = std::path::Path::new(dir).join(program);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

pub struct PtyChild {
    pub master: OwnedFd,
    pub pid: Pid,
}

/// PTY 上でプロセスを fork+exec する（Python `pty.fork()` + `os.execvpe` 相当）。
/// `spec` は呼び出し前に完全に組み立て済みであること（fork 後の子は syscall のみ）。
pub fn spawn(spec: &ExecSpec, cols: u16, rows: u16) -> io::Result<PtyChild> {
    let winsize = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // argv/envp の生ポインタ配列は fork 前に確保しておく（子プロセスでは
    // 追加のメモリ確保を一切行わず、既存ポインタで execve するだけにするため）。
    let mut argv_ptrs: Vec<*const libc::c_char> = spec.argv.iter().map(|s| s.as_ptr()).collect();
    argv_ptrs.push(std::ptr::null());
    let mut envp_ptrs: Vec<*const libc::c_char> = spec.envp.iter().map(|s| s.as_ptr()).collect();
    envp_ptrs.push(std::ptr::null());
    let program_ptr = spec.program_path.as_ptr();

    // SAFETY: 子プロセス分岐は execve 呼び出しまで async-signal-safe な操作
    // （syscall のみ）に限定している。argv_ptrs/envp_ptrs/program_ptr は
    // fork 前に構築済みで、子はそれらのポインタを読むだけ（新規確保なし）。
    match unsafe { nix::pty::forkpty(&winsize, None) } {
        Ok(ForkptyResult::Child) => {
            // ここから execve まではメモリ確保・Rust の Drop 実行を一切行わない。
            unsafe {
                libc::execve(program_ptr, argv_ptrs.as_ptr(), envp_ptrs.as_ptr());
            }
            // execve が返ってきたら失敗。バッファリング等を経由せず直接終了する。
            unsafe { libc::_exit(1) }
        }
        Ok(ForkptyResult::Parent { child, master }) => {
            set_nonblocking(master.as_raw_fd())?;
            Ok(PtyChild { master, pid: child })
        }
        Err(e) => Err(io::Error::from(e)),
    }
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// アタッチ済みクライアント PTY の winsize を更新する（Python `resize_client_pty`）。
/// stale fd 上での ioctl 失敗は無視する（クローズ済み fd でのクラッシュを避けるため）。
pub fn resize(fd: RawFd, cols: u16, rows: u16) {
    let winsize = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    unsafe {
        libc::ioctl(fd, libc::TIOCSWINSZ, &winsize);
    }
}

/// master 側を async に読む薄いラッパー。`AsyncFd` は non-blocking fd を要求する
/// （`spawn` が既に O_NONBLOCK を設定済み）。
pub struct AsyncPty {
    inner: tokio::io::unix::AsyncFd<OwnedFd>,
}

impl AsyncPty {
    pub fn new(fd: OwnedFd) -> io::Result<Self> {
        Ok(Self {
            inner: tokio::io::unix::AsyncFd::new(fd)?,
        })
    }

    pub fn as_raw_fd(&self) -> RawFd {
        self.inner.get_ref().as_raw_fd()
    }

    /// 内部の `OwnedFd` を取り出す（クローズ責務を呼び出し側へ返す）。
    pub fn into_inner(self) -> OwnedFd {
        self.inner.into_inner()
    }

    /// 1回分の read。EOF は `Ok(0)`、PTY が刈り取られた後の `EIO` も EOF 扱いにする
    /// （tmux セッション終了時、Linux の PTY マスタは close ではなく EIO を返す）。
    pub async fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.inner.readable().await?;
            let fd = self.inner.get_ref().as_raw_fd();
            let result = guard.try_io(|_| {
                let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                if n < 0 {
                    let err = io::Error::last_os_error();
                    if err.raw_os_error() == Some(libc::EIO) {
                        return Ok(0); // 相手側 PTY が閉じた（子プロセス終了）
                    }
                    Err(err)
                } else {
                    Ok(n as usize)
                }
            });
            match result {
                Ok(inner) => return inner,
                Err(_would_block) => continue,
            }
        }
    }
}

/// PTY をクローズし、子プロセスへ SIGTERM → (未刈り取りなら) SIGKILL の順で送る
/// （Python `close_pty` 相当）。
pub fn close(master: OwnedFd, pid: Pid) {
    drop(master); // fd を閉じる
    use nix::sys::signal::{kill, Signal};
    use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
    if kill(pid, Signal::SIGTERM).is_err() {
        return;
    }
    let still_alive = matches!(
        waitpid(pid, Some(WaitPidFlag::WNOHANG)),
        Ok(WaitStatus::StillAlive)
    );
    if still_alive {
        // Python の 0.1 秒猶予と同一
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = kill(pid, Signal::SIGKILL);
        let _ = waitpid(pid, Some(WaitPidFlag::WNOHANG));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_in_path_finds_known_binary() {
        // /bin/sh か /usr/bin/sh のどちらかは大半の POSIX 環境に存在する
        let resolved = resolve_in_path("sh", "/usr/bin:/bin");
        assert!(resolved.is_some(), "sh should resolve via PATH");
        assert!(resolved.unwrap().ends_with("/sh"));
    }

    #[test]
    fn resolve_in_path_missing_returns_none() {
        assert!(resolve_in_path("no-such-binary-xyz-123", "/usr/bin:/bin").is_none());
    }

    #[test]
    fn resolve_in_path_absolute_checks_existence() {
        assert!(
            resolve_in_path("/bin/sh", "").is_some()
                || resolve_in_path("/usr/bin/sh", "").is_some()
        );
        assert!(resolve_in_path("/no/such/path-xyz", "").is_none());
    }

    #[tokio::test]
    async fn spawn_and_read_echo() {
        let spec = ExecSpec::resolve(
            "sh",
            &["-c", "echo hello-pty"],
            &[("PATH", "/usr/bin:/bin"), ("TERM", "xterm-256color")],
        )
        .unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        let pid = child.pid;
        let pty = AsyncPty::new(child.master).unwrap();
        let mut collected = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(5), pty.read(&mut buf)).await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => collected.extend_from_slice(&buf[..n]),
                Ok(Err(e)) => panic!("read error: {e}"),
                Err(_) => panic!("timed out waiting for PTY output"),
            }
        }
        let text = String::from_utf8_lossy(&collected);
        assert!(text.contains("hello-pty"), "output was: {text:?}");
        let _ = nix::sys::wait::waitpid(pid, None);
    }

    #[tokio::test]
    async fn resize_does_not_error_on_live_fd() {
        let spec =
            ExecSpec::resolve("sh", &["-c", "sleep 2"], &[("PATH", "/usr/bin:/bin")]).unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        resize(child.master.as_raw_fd(), 120, 40);
        close(child.master, child.pid);
    }

    #[test]
    fn missing_program_errors() {
        let err = ExecSpec::resolve("no-such-binary-xyz-123", &[], &[("PATH", "/usr/bin:/bin")])
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn close_reaps_terminated_child() {
        let spec =
            ExecSpec::resolve("sh", &["-c", "exit 0"], &[("PATH", "/usr/bin:/bin")]).unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        close(child.master, child.pid);
    }
}
