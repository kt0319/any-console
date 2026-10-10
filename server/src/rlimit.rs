//! プロセスのファイルディスクリプタ上限（RLIMIT_NOFILE）の引き上げ。
//!
//! launchd 配下の既定ソフト上限は 256 で、ターミナル・WebSocket・preview proxy が
//! 積み上がると `Too many open files` で git / tmux の起動まで失敗する。

use std::io;

/// macOS は hard が RLIM_INFINITY でも `setrlimit` が OPEN_MAX 超を EINVAL で拒否する。
const NOFILE_TARGET: u64 = 10_240;

/// ソフト上限を `NOFILE_TARGET`（hard 上限まで）に引き上げ、(変更前, 変更後) を返す。
pub fn raise_nofile_limit() -> io::Result<(u64, u64)> {
    let mut lim = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let before = lim.rlim_cur;
    let target = NOFILE_TARGET.min(lim.rlim_max);
    if target <= before {
        return Ok((before, before));
    }
    lim.rlim_cur = target;
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &lim) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((before, target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raise_nofile_limit_never_lowers_soft_limit() {
        let (before, after) = raise_nofile_limit().expect("setrlimit");
        assert!(after >= before);
        let (again_before, again_after) = raise_nofile_limit().expect("idempotent");
        assert_eq!(again_before, after);
        assert_eq!(again_after, after);
    }
}
