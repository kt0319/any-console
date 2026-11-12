//! 新規セッションに予約した入力（保留テキスト）をターミナルへ届ける処理（WebSocket attach 時の flush と、
//! direct dispatch でエージェントの起動を待ってからの送信）。

use super::*;

/// dispatch が新規セッションに予約したテキストを attach 後の初期 redraw を
/// 待ってから送る（Python `_flush_pending_text` 相当。永続先が tmux 環境変数
/// なのでプロセスをまたいでも安全 — 詳細は dispatch.rs のコメント参照）。
///
/// 保留テキストが無くて何もしなかったときは false を返す（呼び出し側が flush 権を手放す）。
pub(super) async fn flush_pending_text(
    state: &Arc<AppState>,
    full_tmux_name: &str,
    session_id: &str,
) -> bool {
    tokio::time::sleep(Duration::from_secs_f64(PENDING_TEXT_DELAY_SEC)).await;
    let meta = tmux::load_tmux_metadata(full_tmux_name).await;
    let Some(encoded) = meta.get("TMUX_PENDING_TEXT").filter(|s| !s.is_empty()) else {
        return false;
    };
    // dispatch.rs 側の set_pending_text が hex エンコードして保存している
    // （複数行 text が1行の tmux 環境変数値として壊れずに運べるようにするため）。
    let text = tmux::decode_pending_text(encoded);
    let enter = meta.get("TMUX_PENDING_ENTER").map(String::as_str) != Some("0");
    let agent_only = meta.get("TMUX_PENDING_AGENT_ONLY").map(String::as_str) == Some("1");
    if agent_only {
        // direct dispatch の入力は、ブラウザ接続や再起動後の復元でここへ来ても
        // エージェントが前面にいる時だけ送る（シェルへ流さない）。
        if let Err(detail) = deliver_pending_text_to_agent_process(
            state,
            full_tmux_name,
            Duration::from_secs_f64(AGENT_START_TIMEOUT_SEC),
            Duration::from_secs_f64(AGENT_READY_TIMEOUT_SEC),
        )
        .await
        {
            let workspace = match state.terminal_session(session_id).await {
                Ok(session) => session.lock().await.workspace.clone(),
                Err(_) => None,
            }
            .unwrap_or_else(|| session_id.to_string());
            crate::dispatch::report_direct_input_not_delivered(
                state, &workspace, session_id, &detail,
            );
        }
        return true;
    }
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_TEXT").await;
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_ENTER").await;
    // job が claude/codex 等の既知エージェントとして識別できる場合だけ、
    // 実際にプロンプト入力待ち（idle）になるまで待つ（`wait_agent_idle_if_known`
    // のコメント参照）。
    wait_agent_idle_if_known(state, full_tmux_name).await;
    if !text.is_empty() && !tmux::send_keys_to_tmux(full_tmux_name, &text, enter).await {
        tracing::warn!("pending text send-keys failed session={session_id}");
    }
    true
}

/// direct dispatch 用に、ブラウザの接続なしで pending text をエージェントへ送る。
/// `flush_pending_text` と同じく flush 権を1回だけクレームするので、後からターミナルへ
/// attach されても二重には送られない。
///
/// セッションは保留テキストの設定前に公開されるため、早く attach した WS が flush 権を
/// 持っていることがある。その WS は保留テキストが無ければ権利を手放し、あれば自分で
/// 送って環境変数を消す。どちらになるかを待ってから、取れたら送り、消えていたら
/// 送信済みとして扱う。
pub(crate) async fn deliver_pending_text_to_agent(
    state: &Arc<AppState>,
    session_id: &str,
) -> Result<(), String> {
    let session_arc = state
        .terminal_session(session_id)
        .await
        .map_err(|e| e.detail)?;
    deliver_pending_text_when_claimable(
        state,
        &session_arc,
        Duration::from_secs_f64(PENDING_CLAIM_WAIT_SEC),
        Duration::from_secs_f64(AGENT_START_TIMEOUT_SEC),
        Duration::from_secs_f64(AGENT_READY_TIMEOUT_SEC),
    )
    .await
}

pub(super) async fn deliver_pending_text_when_claimable(
    state: &Arc<AppState>,
    session_arc: &Arc<tokio::sync::Mutex<crate::terminal_session::TerminalSession>>,
    claim_wait: Duration,
    start_timeout: Duration,
    ready_timeout: Duration,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + claim_wait;
    loop {
        let (claimed, full_tmux_name) = {
            let mut session = session_arc.lock().await;
            (
                session.claim_pending_text_flush(),
                session.tmux_session_name.clone(),
            )
        };
        if let Some(full_tmux_name) = claimed {
            return deliver_pending_text_to_agent_process(
                state,
                &full_tmux_name,
                start_timeout,
                ready_timeout,
            )
            .await;
        }
        let meta = tmux::load_tmux_metadata(&full_tmux_name).await;
        if meta
            .get("TMUX_PENDING_TEXT")
            .is_none_or(|text| text.is_empty())
        {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "Another connection holds the input delivery and did not finish it".to_string(),
            );
        }
        tokio::time::sleep(Duration::from_secs_f64(AGENT_READY_POLL_INTERVAL_SEC)).await;
    }
}

/// 前面がエージェントのプロセスであることを確かめてから送る。job のコマンドが
/// 終了してシェルのプロンプトに戻っていた場合、テキストはシェルへの入力になり
/// 任意のコマンド実行になってしまうため、エージェントが見つからなければ送らずに
/// エラーを返す（未送信のテキストは tmux 環境変数からも消す）。
pub(super) async fn deliver_pending_text_to_agent_process(
    state: &Arc<AppState>,
    full_tmux_name: &str,
    start_timeout: Duration,
    ready_timeout: Duration,
) -> Result<(), String> {
    tokio::time::sleep(Duration::from_secs_f64(PENDING_TEXT_DELAY_SEC)).await;
    let meta = tmux::load_tmux_metadata(full_tmux_name).await;
    let Some(encoded) = meta.get("TMUX_PENDING_TEXT").filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let text = tmux::decode_pending_text(encoded);
    let enter = meta.get("TMUX_PENDING_ENTER").map(String::as_str) != Some("0");
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_TEXT").await;
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_ENTER").await;
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_AGENT_ONLY").await;
    if text.is_empty() {
        return Ok(());
    }
    let Some(manifest) = wait_agent_process(state, full_tmux_name, start_timeout).await else {
        return Err("The agent did not start; the input was not delivered".to_string());
    };
    if !wait_agent_idle(full_tmux_name, &manifest, ready_timeout).await {
        return Err(
            "The agent did not become ready for input; the input was not delivered".to_string(),
        );
    }
    if running_agent(state, full_tmux_name).await.is_none() {
        return Err("The agent exited before the input could be delivered".to_string());
    }
    if !tmux::send_keys_to_tmux(full_tmux_name, &text, enter).await {
        return Err("Failed to send the input to the agent session".to_string());
    }
    Ok(())
}

/// 前面のエージェントを特定する。プロセス名で当たらないときは、前面プロセスの argv で
/// 照合する（node / python などのランタイム上で動くエージェント向け。`agent_watch` と同じ）。
pub(super) async fn running_agent(
    state: &Arc<AppState>,
    full_tmux_name: &str,
) -> Option<Arc<screen_manifest::Manifest>> {
    let (command, _) = tmux::pane_command_and_title(full_tmux_name).await?;
    if let Some(manifest) = state.manifest_store.identify_agent(Some(&command)) {
        return Some(manifest);
    }
    let pane_pid = tmux::pane_pid(full_tmux_name).await?;
    let argvs = crate::foreground::ForegroundInspector::new()
        .argvs(pane_pid as i32)
        .await;
    state.manifest_store.identify_agent_from_argvs(&argvs)
}

pub(super) async fn wait_agent_process(
    state: &Arc<AppState>,
    full_tmux_name: &str,
    timeout: Duration,
) -> Option<Arc<screen_manifest::Manifest>> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Some(manifest) = running_agent(state, full_tmux_name).await {
            return Some(manifest);
        }
        if tokio::time::Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_secs_f64(AGENT_READY_POLL_INTERVAL_SEC)).await;
    }
}

/// job（例: `claude`）が既知のAIエージェント（`agent_manifests/`で定義済み）
/// と識別できる場合だけ、画面が実際にidle（プロンプト入力待ち）になるまで
/// ポーリングする。判定できない任意コマンドのjob（stdinを読まないデーモン的
/// プロセス等も多い）には汎用的な「入力受付可能」の検知手段が無いため、
/// 何もせず即座に返す（この場合は従来通り `PENDING_TEXT_DELAY_SEC` の固定
/// 待ちのみに依存する）。
///
/// `agent_watch::resolve_session_state` を画面差分の履歴（prev_capture）無しで
/// 呼ぶため、manifestのルールに一致しない間はscreen diffフォールバックが常に
/// "idle" を返してしまう（`classify_agent_state`参照）。これは意味の無い
/// idle判定のため、`AgentStateSource::Manifest` 由来のidleだけを本物の
/// ready signal として扱う。
pub(super) async fn wait_agent_idle_if_known(state: &Arc<AppState>, full_tmux_name: &str) {
    let Some((command, _)) = tmux::pane_command_and_title(full_tmux_name).await else {
        return;
    };
    let Some(manifest) = state.manifest_store.identify_agent(Some(&command)) else {
        return;
    };
    let ready_timeout = Duration::from_secs_f64(AGENT_READY_TIMEOUT_SEC);
    if !wait_agent_idle(full_tmux_name, &manifest, ready_timeout).await {
        tracing::warn!("agent not idle before pending text send session={full_tmux_name}");
    }
}

/// manifest 由来の idle を観測できれば true。タイムアウトや画面取得失敗は false。
pub(super) async fn wait_agent_idle(
    full_tmux_name: &str,
    manifest: &Arc<screen_manifest::Manifest>,
    timeout: Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        let Some(capture) = tmux::capture_visible_pane(full_tmux_name).await else {
            return false;
        };
        let title = tmux::pane_command_and_title(full_tmux_name)
            .await
            .map(|(_, title)| title)
            .unwrap_or_default();
        let (state_str, source) =
            agent_watch::resolve_session_state(&capture, None, Some(manifest), &title);
        if state_str == screen_manifest::STATE_IDLE
            && source == agent_watch::AgentStateSource::Manifest
        {
            return true;
        }
        tokio::time::sleep(Duration::from_secs_f64(AGENT_READY_POLL_INTERVAL_SEC)).await;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_tmux_session(name: &str) {
        let created = crate::subprocess::run_tmux_cmd(&["new-session", "-d", "-s", name]).await;
        assert!(
            created.as_ref().is_some_and(|r| r.success()),
            "tmux session {name} could not be created: {created:?}"
        );
    }

    #[tokio::test]
    async fn flush_pending_text_sends_and_clears_env() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let name = format!("test-pending-{}", crate::util::token_hex(4));
        create_test_tmux_session(&name).await;
        let encoded = tmux::encode_pending_text("echo pending-flush");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;
        // CI の負荷下では tmux サーバ起動に2秒を超えることがあるため余裕を持たせる
        assert!(tmux::wait_pane_ready(&name, 10.0).await);

        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        flush_pending_text(&state, &name, "test-session").await;

        let meta = tmux::load_tmux_metadata(&name).await;
        assert!(!meta.contains_key("TMUX_PENDING_TEXT"));

        // send-keys 自体は完了済みだが、シェルが Enter を処理し出力するまで
        // 数十ms 掛かることがあるため短時間ポーリングする。
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let mut found = false;
        while tokio::time::Instant::now() < deadline {
            let content = crate::subprocess::run_subprocess_safe(
                &["tmux", "capture-pane", "-t", &name, "-p"],
                5.0,
                None,
            )
            .await
            .unwrap();
            if content.stdout.contains("pending-flush") {
                found = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(found, "pending text was not sent to the pane");

        crate::subprocess::kill_tmux_by_name(&name).await;
    }

    #[tokio::test]
    async fn agent_delivery_refuses_to_type_into_a_plain_shell() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let name = format!("test-agent-delivery-{}", crate::util::token_hex(4));
        create_test_tmux_session(&name).await;
        let encoded = tmux::encode_pending_text("echo must-not-run");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;
        assert!(tmux::wait_pane_ready(&name, 10.0).await);

        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let result = deliver_pending_text_to_agent_process(
            &state,
            &name,
            Duration::from_millis(600),
            Duration::from_millis(600),
        )
        .await;
        assert!(result.is_err());

        let meta = tmux::load_tmux_metadata(&name).await;
        assert!(
            !meta.contains_key("TMUX_PENDING_TEXT"),
            "undelivered text must not stay around for a later attach to flush"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        let screen = tmux::capture_visible_pane(&name).await.unwrap_or_default();
        assert!(!screen.contains("must-not-run"));
        crate::subprocess::run_subprocess_safe(&["tmux", "kill-session", "-t", &name], 5.0, None)
            .await;
    }

    #[tokio::test]
    async fn running_agent_is_found_through_the_runtime_script_name() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("agent_manifests")).unwrap();
        std::fs::write(
            dir.path().join("agent_manifests/sleep.toml"),
            "id = \"sleep\"\nversion = \"2026.01.01.1\"\nmin_engine_version = 1\nupdated_at = \"2026-01-01T00:00:00Z\"\n\n[[rules]]\nid = \"idle\"\nstate = \"idle\"\npriority = 100\nregion = \"whole_recent\"\ncontains = [\"x\"]\n",
        )
        .unwrap();
        // プロセス名は python3 になるが、スクリプト名（sleep）でエージェントと識別できる。
        let script = dir.path().join("sleep");
        std::fs::write(&script, "import time\ntime.sleep(60)\n").unwrap();

        let name = format!("test-runtime-agent-{}", crate::util::token_hex(4));
        // 実運用と同じく、ペインのシェルからジョブのコマンドを実行する。
        create_test_tmux_session(&name).await;
        assert!(tmux::wait_pane_ready(&name, 10.0).await);
        let command = format!("python3 {}", script.display());
        assert!(tmux::send_keys_to_tmux(&name, &command, true).await);
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let found = wait_agent_process(&state, &name, Duration::from_secs(5)).await;
        crate::subprocess::run_subprocess_safe(&["tmux", "kill-session", "-t", &name], 5.0, None)
            .await;
        assert_eq!(found.map(|m| m.id.clone()), Some("sleep".to_string()));
    }

    #[tokio::test]
    async fn agent_only_pending_text_is_not_typed_into_a_shell_by_the_websocket_flush() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let name = format!("test-agent-only-{}", crate::util::token_hex(4));
        create_test_tmux_session(&name).await;
        let encoded = tmux::encode_pending_text("echo must-not-run");
        tmux::set_environment(
            &name,
            &[
                ("TMUX_PENDING_TEXT", &encoded),
                ("TMUX_PENDING_ENTER", "1"),
                ("TMUX_PENDING_AGENT_ONLY", "1"),
            ],
        )
        .await;
        assert!(tmux::wait_pane_ready(&name, 10.0).await);

        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        flush_pending_text(&state, &name, "test-session").await;

        let meta = tmux::load_tmux_metadata(&name).await;
        assert!(!meta.contains_key("TMUX_PENDING_TEXT"));
        let screen = tmux::capture_visible_pane(&name).await.unwrap_or_default();
        assert!(!screen.contains("must-not-run"));

        // 届かなかったことは、背景の送信と同じく activity に残る（push 通知も同じ経路）。
        let activity_dir = state.paths.data_dir.join("activity").join("test-session");
        let logged: String = std::fs::read_dir(&activity_dir)
            .expect("the failure must be recorded")
            .filter_map(|e| std::fs::read_to_string(e.unwrap().path()).ok())
            .collect();
        assert!(logged.contains("dispatch_failed"), "{logged}");
        crate::subprocess::run_subprocess_safe(&["tmux", "kill-session", "-t", &name], 5.0, None)
            .await;
    }

    #[tokio::test]
    async fn agent_delivery_fails_when_the_agent_never_becomes_idle() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("agent_manifests")).unwrap();
        std::fs::write(
            dir.path().join("agent_manifests/sleep.toml"),
            "id = \"sleep\"\nversion = \"2026.01.01.1\"\nmin_engine_version = 1\nupdated_at = \"2026-01-01T00:00:00Z\"\n\n[[rules]]\nid = \"idle\"\nstate = \"idle\"\npriority = 100\nregion = \"whole_recent\"\ncontains = [\"never-shown-marker\"]\n",
        )
        .unwrap();
        let script = dir.path().join("sleep");
        std::fs::write(&script, "import time\ntime.sleep(60)\n").unwrap();

        let name = format!("test-never-idle-{}", crate::util::token_hex(4));
        create_test_tmux_session(&name).await;
        assert!(tmux::wait_pane_ready(&name, 10.0).await);
        let command = format!("python3 {}", script.display());
        assert!(tmux::send_keys_to_tmux(&name, &command, true).await);
        let encoded = tmux::encode_pending_text("echo must-not-be-sent");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let result = deliver_pending_text_to_agent_process(
            &state,
            &name,
            Duration::from_secs(5),
            Duration::from_millis(800),
        )
        .await;
        let screen = tmux::capture_visible_pane(&name).await.unwrap_or_default();
        crate::subprocess::run_subprocess_safe(&["tmux", "kill-session", "-t", &name], 5.0, None)
            .await;
        assert!(result.is_err());
        assert!(!screen.contains("must-not-be-sent"));
    }

    async fn registered_test_session(
        state: &Arc<AppState>,
    ) -> Arc<tokio::sync::Mutex<crate::terminal_session::TerminalSession>> {
        let (_, session_arc) = state
            .terminal_registry
            .create_registered_session(
                &state.paths.data_dir,
                &state.config,
                &state.paths.tmux_prefix,
                crate::terminal_session::NewSessionSpec::default(),
            )
            .await
            .expect("session should be created");
        let name = session_arc.lock().await.tmux_session_name.clone();
        assert!(tmux::wait_pane_ready(&name, 10.0).await);
        session_arc
    }

    #[tokio::test]
    async fn direct_delivery_still_runs_after_an_early_attach_found_no_pending_text() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let session_arc = registered_test_session(&state).await;
        let name = session_arc.lock().await.tmux_session_name.clone();

        // 保留テキストの設定前に attach した WS が flush 権を取り、空振りして手放す。
        assert!(session_arc
            .lock()
            .await
            .claim_pending_text_flush()
            .is_some());
        assert!(!flush_pending_text(&state, &name, "early").await);
        session_arc.lock().await.release_pending_text_flush();

        let encoded = tmux::encode_pending_text("echo must-not-run");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;
        let result = deliver_pending_text_when_claimable(
            &state,
            &session_arc,
            Duration::from_secs(2),
            Duration::from_millis(600),
            Duration::from_millis(600),
        )
        .await;

        // 権利を取って送信を試みた（素のシェルなので、エージェント不在として失敗し、
        // 保留テキストは消える）。
        let detail = result.expect_err("a plain shell is not an agent");
        assert!(detail.contains("agent did not start"), "{detail}");
        let meta = tmux::load_tmux_metadata(&name).await;
        assert!(!meta.contains_key("TMUX_PENDING_TEXT"));
        crate::subprocess::kill_tmux_by_name(&name).await;
    }

    #[tokio::test]
    async fn direct_delivery_is_done_when_another_attach_already_consumed_the_text() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let session_arc = registered_test_session(&state).await;
        let name = session_arc.lock().await.tmux_session_name.clone();
        assert!(session_arc
            .lock()
            .await
            .claim_pending_text_flush()
            .is_some());

        let result = deliver_pending_text_when_claimable(
            &state,
            &session_arc,
            Duration::from_secs(2),
            Duration::from_millis(600),
            Duration::from_millis(600),
        )
        .await;
        assert!(result.is_ok());
        crate::subprocess::kill_tmux_by_name(&name).await;
    }

    #[tokio::test]
    async fn direct_delivery_fails_when_another_attach_keeps_the_claim_without_finishing() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "test-", 1000));
        let session_arc = registered_test_session(&state).await;
        let name = session_arc.lock().await.tmux_session_name.clone();
        assert!(session_arc
            .lock()
            .await
            .claim_pending_text_flush()
            .is_some());
        let encoded = tmux::encode_pending_text("echo pending");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;

        let result = deliver_pending_text_when_claimable(
            &state,
            &session_arc,
            Duration::from_millis(600),
            Duration::from_millis(600),
            Duration::from_millis(600),
        )
        .await;
        assert!(result.is_err());
        crate::subprocess::kill_tmux_by_name(&name).await;
    }
}
