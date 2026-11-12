//! direct スコープ（制限つきの即時実行。ADR 34）。

use super::*;

fn workspace_allowed(state: &AppState, requested: &str, allowed: &[String]) -> bool {
    if allowed.iter().any(|w| w == requested) {
        return true;
    }
    let cfg = state.config.load_all();
    let Some(key) = crate::config::ConfigStore::find_workspace_key(&cfg, requested) else {
        return false;
    };
    let name = cfg
        .get(&key)
        .and_then(|entry| entry.get("name"))
        .and_then(Value::as_str);
    allowed
        .iter()
        .any(|w| *w == key || Some(w.as_str()) == name)
}

/// 直近 24 時間にこのトークンが受理された direct の件数。件数は workspace を
/// 横断するため、`_global` の activity ログに `direct_fired` として記録して数える
/// （recent 履歴は 50 件で他の dispatch と共有のため、数え落として上限を超える）。
/// このログは上限判定の根拠なので、ファイルが無いだけの場合以外の読み取り失敗
/// （読めない・UTF-8 でない・行が壊れている）は数え落とさずエラーにする。
fn count_direct_fired(data_dir: &FsPath, token_id: &str, now: i64) -> Result<usize, ApiError> {
    let mut dates = vec![crate::util::utc_date_of_epoch(now - DIRECT_WINDOW_SEC)];
    let today = crate::util::utc_date_of_epoch(now);
    if dates[0] != today {
        dates.push(today);
    }
    let mut count = 0;
    for date in dates {
        let path = data_dir
            .join("activity")
            .join("_global")
            .join(format!("{date}.jsonl"));
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                tracing::error!(
                    "direct quota ledger unreadable path={}: {e}",
                    path.display()
                );
                return Err(server_error("Direct run quota could not be checked"));
            }
        };
        for line in content.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                tracing::error!(
                    "direct quota ledger has a broken line path={}",
                    path.display()
                );
                return Err(server_error("Direct run quota could not be checked"));
            };
            if entry["type"].as_str() == Some(ACTIVITY_EVENT_DIRECT_FIRED)
                && entry["token_id"].as_str() == Some(token_id)
                && entry["at"]
                    .as_i64()
                    .is_some_and(|at| at > now - DIRECT_WINDOW_SEC && at <= now)
            {
                count += 1;
            }
        }
    }
    Ok(count)
}

/// ジョブのコマンドの先頭（`VAR=value` の環境変数指定を除く）が既知のエージェントか。
/// テキストは起動後のセッションの前面プロセスへ送るため、エージェントとして
/// 識別できないジョブ（終了してシェルに戻るコマンドなど）は direct では使わせない。
fn job_command_is_known_agent(state: &AppState, command: &str) -> bool {
    first_program_of_command(command)
        .is_some_and(|program| state.manifest_store.identify_agent(Some(program)).is_some())
}

fn first_program_of_command(command: &str) -> Option<&str> {
    command.split_whitespace().find(|token| {
        let is_env_assignment = token.split_once('=').is_some_and(|(name, _)| {
            !name.is_empty()
                && !name.starts_with(|c: char| c.is_ascii_digit())
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
        !is_env_assignment
    })
}

/// direct の入力がエージェントへ届かなかったことを、activity と push 通知に残す。
/// 背景の送信と、WS が flush 権を持った場合の送信（`terminal/pending_text.rs` の `flush_pending_text`）の
/// 両方から呼ぶ。
pub(crate) fn report_direct_input_not_delivered(
    state: &Arc<AppState>,
    workspace: &str,
    session_id: &str,
    detail: &str,
) {
    tracing::warn!("direct dispatch input not delivered session={session_id}: {detail}");
    log_dispatch_failed(state, workspace, detail);
    let body = format!("{workspace}\n{detail}");
    crate::push::spawn_push_notification(
        state,
        "Dispatch (direct) input not delivered",
        body,
        format!("/?workspace={workspace}&session={session_id}"),
        "dispatch",
        None,
    );
}

/// 起動したセッションへ、ブラウザの接続なしでテキストを送る（無人の呼び出しでは
/// 誰もターミナルを開かないため）。送れなかった場合は push 通知と activity に残す。
fn spawn_agent_input_delivery(state: &Arc<AppState>, launched: &Value) {
    let (Some(session_id), Some(workspace)) = (
        launched["session_id"].as_str().map(str::to_string),
        launched["workspace"].as_str().map(str::to_string),
    ) else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        let Err(detail) = crate::terminal::deliver_pending_text_to_agent(&state, &session_id).await
        else {
            return;
        };
        report_direct_input_not_delivered(&state, &workspace, &session_id, &detail);
    });
}

/// direct スコープで `direct: true` の要求を検証して即時起動する。
/// 承認後の実行と同じ `execute_and_record` を通し、結果は recent 履歴に
/// `auth: direct:<トークン名>` と `token_id` 付きで残る。起動したことは成否にかかわらず
/// push 通知する。
pub(super) async fn dispatch_direct(
    state: &Arc<AppState>,
    mut body: DispatchRequest,
    token: &Value,
    auth_label: &str,
) -> Result<axum::response::Response, ApiError> {
    use axum::response::IntoResponse;

    if !body.direct {
        return Err(bad_request(
            "direct tokens cannot queue dispatches; send \"direct\": true",
        ));
    }
    if body.job.is_empty() || body.job == TERMINAL_JOB_KEY {
        return Err(bad_request(
            "direct tokens require \"job\" to be an agent job (terminal is not allowed)",
        ));
    }
    if body.worktree.as_deref().is_none_or(|w| w.trim().is_empty()) {
        return Err(bad_request("direct tokens require \"worktree\""));
    }
    if body.session_id.is_some() {
        return Err(bad_request(
            "direct tokens always start a new session; \"session_id\" is not allowed",
        ));
    }
    if body.dedup_key.is_some() {
        return Err(bad_request(
            "\"dedup_key\" has no effect on direct dispatches",
        ));
    }

    let token_id = token.get("id").and_then(Value::as_str).unwrap_or_default();
    let limits = crate::auth::DirectTokenLimits::from_entry(token);
    if let Some(allowed) = &limits.allowed_workspaces {
        if !workspace_allowed(state, &body.workspace, allowed) {
            return Err(crate::errors::forbidden(format!(
                "This token is not allowed to run in workspace: {}",
                body.workspace
            )));
        }
    }

    let job_def = resolve_job_def(state, &body.workspace, &body.job)?;
    if !job_command_is_known_agent(state, &job_def.command) {
        return Err(bad_request(
            "direct tokens can only run agent jobs: the job command must start with a known agent (see agent_manifests/)",
        ));
    }

    {
        let _gate = state.dispatch.direct_gate.lock().await;
        let now = now_epoch();
        let used = count_direct_fired(&state.paths.data_dir, token_id, now)?;
        if limits.max_per_day != crate::auth::DIRECT_TOKEN_UNLIMITED_PER_DAY
            && used >= limits.max_per_day as usize
        {
            return Err(crate::errors::too_many_requests(format!(
                "Daily limit reached for this token ({} per 24h)",
                limits.max_per_day
            )));
        }
        // 台帳に記録できなければ起動しない（記録なしに起動すると上限を消費できない）。
        crate::activity::try_log_activity(
            &state.paths.data_dir,
            None,
            ACTIVITY_EVENT_DIRECT_FIRED,
            crate::git_helpers::activity_fields(&[
                ("token_id", json!(token_id)),
                ("at", json!(now)),
            ]),
        )
        .map_err(|e| {
            tracing::error!("direct quota ledger write failed: {e}");
            server_error("Direct run quota could not be recorded")
        })?;
    }

    sweep_expired_dispatch_images(state).await;
    // 既存セッションへ送り込まず、常に新しいセッションを起動する。
    body.match_mode = "none".to_string();
    let dispatch_id = crate::util::token_urlsafe(8);
    let effective_ws = body.effective_workspace();
    let started = dispatch_notification_body(&effective_ws, &body, &JobDef::label_only(&body.job));
    let mut source = Map::new();
    source.insert("auth".to_string(), json!(auth_label));
    source.insert("token_id".to_string(), json!(token_id));
    let result = execute_and_record(
        state,
        &dispatch_id,
        body,
        Some(json!(now_epoch())),
        &DispatchOverrides::default(),
        auth_label,
        Some(&source),
    )
    .await;
    let (title, text) = match &result {
        Ok(_) => ("Dispatch (direct)", started),
        Err(e) => (
            "Dispatch (direct) failed",
            format!("{started}\n{}", e.detail),
        ),
    };
    crate::push::spawn_push_notification(
        state,
        title,
        text,
        format!("/?openDispatchQueue=1&dispatchId={dispatch_id}"),
        "dispatch",
        None,
    );
    let mut response = result?;
    spawn_agent_input_delivery(state, &response);
    if let Value::Object(map) = &mut response {
        map.insert("dispatch_id".to_string(), json!(dispatch_id));
        map.insert("status".to_string(), json!("executed"));
    }
    Ok(Json(response).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_direct_fired(dir: &std::path::Path, token_id: &str, at: i64) {
        crate::activity::log_activity(
            dir,
            None,
            ACTIVITY_EVENT_DIRECT_FIRED,
            crate::git_helpers::activity_fields(&[
                ("token_id", json!(token_id)),
                ("at", json!(at)),
            ]),
        );
    }

    #[test]
    fn count_direct_fired_counts_only_this_token_within_24_hours() {
        let dir = tempfile::tempdir().unwrap();
        let now = now_epoch();
        log_direct_fired(dir.path(), "tok_a", now);
        log_direct_fired(dir.path(), "tok_a", now - 60);
        log_direct_fired(dir.path(), "tok_b", now);
        log_direct_fired(dir.path(), "tok_a", now - DIRECT_WINDOW_SEC - 1);
        assert_eq!(count_direct_fired(dir.path(), "tok_a", now).unwrap(), 2);
        assert_eq!(count_direct_fired(dir.path(), "tok_b", now).unwrap(), 1);
        assert_eq!(count_direct_fired(dir.path(), "tok_none", now).unwrap(), 0);
    }

    #[test]
    fn count_direct_fired_treats_a_missing_ledger_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            count_direct_fired(dir.path(), "tok_a", now_epoch()).unwrap(),
            0
        );
    }

    #[test]
    fn count_direct_fired_fails_closed_when_the_ledger_cannot_be_read() {
        let now = now_epoch();
        let today = crate::util::utc_date_of_epoch(now);
        for content in [&b"\xff\xfe not utf-8\n"[..], &b"{broken json\n"[..]] {
            let dir = tempfile::tempdir().unwrap();
            let ledger = dir.path().join("activity").join("_global");
            std::fs::create_dir_all(&ledger).unwrap();
            std::fs::write(ledger.join(format!("{today}.jsonl")), content).unwrap();
            assert!(count_direct_fired(dir.path(), "tok_a", now).is_err());
        }
    }

    #[test]
    fn first_program_of_command_skips_env_assignments() {
        assert_eq!(first_program_of_command("claude --x"), Some("claude"));
        assert_eq!(
            first_program_of_command("FOO=1 BAR_2=x claude"),
            Some("claude")
        );
        assert_eq!(first_program_of_command("  codex  "), Some("codex"));
        assert_eq!(first_program_of_command("npm run build"), Some("npm"));
        assert_eq!(first_program_of_command("./run=weird"), Some("./run=weird"));
        assert_eq!(first_program_of_command(""), None);
        assert_eq!(first_program_of_command("FOO=1"), None);
    }
}
