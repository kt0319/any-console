//! ターミナルセッションのエージェント状態判定（Python 側 `api/agent_watch.py` の
//! 移植のうち、状態判定・フレーズ通知の猶予判定・配信ペイロード整形という
//! 純粋ロジック部分）。
//!
//! 状態は3値（working / idle / blocked）。判定は screen manifest（既知エージェント）
//! を優先し、確定しない場合は画面差分にフォールバックする
//! （`docs/RUST_MIGRATION.md` 参照。hooks 優先度は `agent_hooks.rs` 側で実装済み、
//! ここでは合成しない）。
//!
//! tmux ポーリングループ本体（`_poll_loop`）・WebSocket 購読者管理
//! （`subscribe`/`unsubscribe`）・自動紐付け（cwd からのワークスペース自動判定・
//! 前面ジョブからのジョブ自動タグ付けを `TerminalSession` へ刻印する処理）・
//! push 通知連携（`push.py` 経由）はまだ移植していない。これらは tmux の
//! ペイン問い合わせ（`capture_visible_pane`/`list_pane_meta` 相当、まだ
//! `tmux.rs` に無い）・`TerminalRegistry` への書き戻し・status stream の実体
//! （`ws_broadcast.py`/`routers/status_stream.py`）・`git_watch.rs` の FS 監視
//! ループ・`dispatch.rs` の直接配信化と合わせて一括で配線する
//! （`docs/RUST_MIGRATION.md` の Phase 4/5 再スコープ参照）。

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::screen_manifest::{Manifest, ADOPTED_STATES};

pub const STATE_WORKING: &str = "working";
pub const STATE_IDLE: &str = "idle";

/// 可視ペインの内容からセッション状態を判定する純関数。
///
/// - 前回ポーリングから出力が変化していれば working（スピナー等の動きも拾う）
/// - 画面が静止していれば idle
pub fn classify_agent_state(capture: &str, prev_capture: Option<&str>) -> &'static str {
    match prev_capture {
        Some(prev) if prev != capture => STATE_WORKING,
        _ => STATE_IDLE,
    }
}

/// 画面差分と screen manifest を統合してセッション状態を決める。
///
/// 既知エージェント（manifest が特定済み）は manifest 判定
/// （blocked / working / idle）を優先し、確定しない場合
/// （ルール不一致・unknown・skip_state_update）は画面差分の結果を使う。
pub fn resolve_session_state(
    capture: &str,
    prev_capture: Option<&str>,
    manifest: Option<&Manifest>,
    pane_title: &str,
) -> String {
    let diff_state = classify_agent_state(capture, prev_capture).to_string();
    if let Some(manifest) = manifest {
        if let Some(manifest_state) =
            crate::screen_manifest::evaluate_state(manifest, capture, pane_title, "")
        {
            if ADOPTED_STATES.contains(&manifest_state.as_str()) {
                return manifest_state;
            }
        }
    }
    diff_state
}

/// 前回配信から状態が変わったセッションだけを取り出す純関数。
pub fn diff_states(
    previous: &HashMap<String, String>,
    current: &HashMap<String, String>,
) -> HashMap<String, String> {
    current
        .iter()
        .filter(|(id, state)| previous.get(id.as_str()).map(|s| s.as_str()) != Some(state.as_str()))
        .map(|(id, state)| (id.clone(), state.clone()))
        .collect()
}

pub fn states_payload(states: &HashMap<String, String>) -> Value {
    let entries: Vec<Value> = states
        .iter()
        .map(|(session_id, state)| json!({"session_id": session_id, "state": state}))
        .collect();
    json!({"type": "agent_states", "states": entries})
}

pub fn phrase_notify_payload(session_id: &str, phrase: &str, workspace: Option<&str>) -> Value {
    json!({
        "type": "phrase_notify",
        "session_id": session_id,
        "phrase": phrase,
        "workspace": workspace,
    })
}

pub fn phrase_notify_clear_payload(session_id: &str) -> Value {
    json!({"type": "phrase_notify_clear", "session_id": session_id})
}

/// フレーズ通知の検出→猶予判定の状態を保持する（Python 側の
/// `_phrase_detected_at` / `_phrase_notified` / `_phrase_ws_notified` 相当。
/// モジュールグローバルの代わりにポーリングループが専有するインスタンスとして
/// 持つ設計にした）。
#[derive(Default)]
pub struct PhraseNotifyTracker {
    detected_at: HashMap<String, f64>,
    notified: HashSet<String>,
    ws_notified: HashSet<String>,
}

impl PhraseNotifyTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// `(should_push, should_clear_ws)` を返す。
    ///
    /// should_push: notify_phrase 検出から grace_sec 秒アクティビティが無ければ
    /// true。should_clear_ws: 検出後にアクティビティがあり push を見送った瞬間に
    /// true（タブ通知マークを取り消すタイミングとしてそのまま使う）。
    pub fn should_notify_phrase(
        &mut self,
        session_id: &str,
        notify_phrase: &str,
        capture: &str,
        changed: bool,
        now: f64,
        grace_sec: f64,
    ) -> (bool, bool) {
        if notify_phrase.is_empty() || !capture.contains(notify_phrase) {
            self.detected_at.remove(session_id);
            self.notified.remove(session_id);
            return (false, false);
        }
        if self.notified.contains(session_id) {
            return (false, false);
        }
        if !self.detected_at.contains_key(session_id) {
            // 初検出。フレーズ出現自体による変化は無視し、これ以降の変化だけを見る。
            self.detected_at.insert(session_id.to_string(), now);
            return (false, false);
        }
        if changed {
            // 検出後に画面が動いた = 見ていた とみなし、このフレーズ出現では通知しない。
            self.detected_at.remove(session_id);
            self.notified.insert(session_id.to_string());
            return (false, true);
        }
        if now - self.detected_at[session_id] >= grace_sec {
            self.notified.insert(session_id.to_string());
            self.detected_at.remove(session_id);
            return (true, false);
        }
        (false, false)
    }

    /// タブの通知マーク用の判定。push と違い「見ていたか」の推測猶予を待たず、
    /// 検出したポーリング周期で即座に true を返す（見れば消える表示のため
    /// 誤検知コストが低い）。フレーズが画面から消えたら次の出現でまた通知できる
    /// ようリセットする。
    pub fn should_ws_notify_phrase(
        &mut self,
        session_id: &str,
        notify_phrase: &str,
        capture: &str,
    ) -> bool {
        if notify_phrase.is_empty() || !capture.contains(notify_phrase) {
            self.ws_notified.remove(session_id);
            return false;
        }
        if self.ws_notified.contains(session_id) {
            return false;
        }
        self.ws_notified.insert(session_id.to_string());
        true
    }

    /// ポーリング1周期の終わりに、消えたセッションの残留状態を掃除する。
    pub fn prune(&mut self, live_session_ids: &HashSet<String>) {
        self.detected_at.retain(|k, _| live_session_ids.contains(k));
        self.notified.retain(|k| live_session_ids.contains(k));
        self.ws_notified.retain(|k| live_session_ids.contains(k));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::screen_manifest::ManifestStore;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // ─── classify_agent_state ────────────────────────────────────────────

    #[test]
    fn output_change_is_working() {
        assert_eq!(
            classify_agent_state("spinner /", Some("spinner -")),
            STATE_WORKING
        );
    }

    #[test]
    fn static_screen_is_idle() {
        let text = "$ ls\nREADME.md\n$ ";
        assert_eq!(classify_agent_state(text, Some(text)), STATE_IDLE);
    }

    #[test]
    fn first_poll_is_idle() {
        assert_eq!(classify_agent_state("anything", None), STATE_IDLE);
    }

    // ─── diff_states ─────────────────────────────────────────────────────

    #[test]
    fn only_changed_entries_are_returned() {
        let prev = map(&[("a", "working"), ("b", "idle")]);
        let cur = map(&[("a", "working"), ("b", "working"), ("c", "idle")]);
        assert_eq!(
            diff_states(&prev, &cur),
            map(&[("b", "working"), ("c", "idle")])
        );
    }

    #[test]
    fn removed_sessions_are_not_reported() {
        let prev = map(&[("a", "working")]);
        let cur = HashMap::new();
        assert!(diff_states(&prev, &cur).is_empty());
    }

    // ─── payload shapes ──────────────────────────────────────────────────

    #[test]
    fn states_payload_shape() {
        let payload = states_payload(&map(&[("s1", "idle")]));
        assert_eq!(
            payload,
            json!({"type": "agent_states", "states": [{"session_id": "s1", "state": "idle"}]})
        );
    }

    #[test]
    fn phrase_notify_payload_shape() {
        let payload = phrase_notify_payload("s1", "done!", Some("my-ws"));
        assert_eq!(
            payload,
            json!({"type": "phrase_notify", "session_id": "s1", "phrase": "done!", "workspace": "my-ws"})
        );
    }

    #[test]
    fn phrase_notify_payload_workspace_none_is_preserved() {
        let payload = phrase_notify_payload("s1", "done!", None);
        assert_eq!(payload["workspace"], Value::Null);
    }

    #[test]
    fn phrase_notify_clear_payload_shape() {
        assert_eq!(
            phrase_notify_clear_payload("s1"),
            json!({"type": "phrase_notify_clear", "session_id": "s1"})
        );
    }

    // ─── resolve_session_state（screen manifest 統合）─────────────────────

    fn bundled_store() -> (ManifestStore, tempfile::TempDir) {
        let manifest_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../api/agent_manifests");
        let dir = tempfile::tempdir().unwrap();
        (ManifestStore::new(manifest_dir, dir.path()), dir)
    }

    #[test]
    fn claude_permission_prompt_marks_blocked() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "Running command...\n\
             ──────────────────────────────\n\
             Do you want to proceed?\n\
             ❯ 1. Yes\n  2. No\nesc to cancel\n";
        assert_eq!(
            resolve_session_state(screen, None, Some(&claude), ""),
            "blocked"
        );
    }

    #[test]
    fn blocked_overrides_working_screen_diff() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let base = "──────────────────────────────\nDo you want to proceed?\n❯ 1. Yes\n  2. No\nesc to cancel\n";
        let next = format!("{base}tick\n");
        assert_eq!(
            resolve_session_state(&next, Some(base), Some(&claude), ""),
            "blocked"
        );
    }

    #[test]
    fn unknown_agent_keeps_diff_based_state() {
        let screen = "Do you want to proceed?\n❯ 1. Yes\n  2. No\nesc to cancel\n";
        assert_eq!(resolve_session_state(screen, None, None, ""), "idle");
    }

    #[test]
    fn manifest_idle_overrides_screen_diff() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let box_ = "──────────\n❯ \n──────────\n";
        let prev = format!("output tick 1\n{box_}");
        let cur = format!("output tick 2\n{box_}");
        assert_eq!(
            resolve_session_state(&cur, Some(&prev), Some(&claude), ""),
            "idle"
        );
    }

    #[test]
    fn osc_title_spinner_marks_working_on_static_screen() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "static output";
        assert_eq!(
            resolve_session_state(screen, Some(screen), Some(&claude), "⠋ Thinking…"),
            "working"
        );
    }

    // ─── PhraseNotifyTracker ─────────────────────────────────────────────

    #[test]
    fn no_phrase_present_never_notifies() {
        let mut tracker = PhraseNotifyTracker::new();
        let (push, clear) =
            tracker.should_notify_phrase("s1", "done", "still running", false, 0.0, 20.0);
        assert_eq!((push, clear), (false, false));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "still running"));
    }

    #[test]
    fn first_detection_does_not_push_immediately() {
        let mut tracker = PhraseNotifyTracker::new();
        let (push, clear) = tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        assert_eq!((push, clear), (false, false));
    }

    #[test]
    fn grace_period_elapsed_without_activity_pushes() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        let (push, clear) = tracker.should_notify_phrase("s1", "done", "done!", false, 121.0, 20.0);
        assert_eq!((push, clear), (true, false));
        // 通知済みなので、以後は同じフレーズが出続けても再通知しない
        let (push2, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 200.0, 20.0);
        assert!(!push2);
    }

    #[test]
    fn activity_after_detection_suppresses_and_clears() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        let (push, clear) =
            tracker.should_notify_phrase("s1", "done", "done! tick", true, 105.0, 20.0);
        assert_eq!((push, clear), (false, true));
        // 見送った後、フレーズが再検出されればまた新規検出として扱う
        let (push2, _) =
            tracker.should_notify_phrase("s1", "done", "done! tick2", true, 106.0, 20.0);
        assert!(!push2);
    }

    #[test]
    fn phrase_disappearing_resets_detection() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        tracker.should_notify_phrase("s1", "done", "no phrase here", false, 105.0, 20.0);
        // 消えた後に再出現すれば、また初検出扱いになる（即座には通知しない）
        let (push, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 106.0, 20.0);
        assert!(!push);
    }

    #[test]
    fn ws_notify_fires_immediately_and_only_once_per_appearance() {
        let mut tracker = PhraseNotifyTracker::new();
        assert!(tracker.should_ws_notify_phrase("s1", "done", "done!"));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "done! still here"));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "gone now"));
        assert!(tracker.should_ws_notify_phrase("s1", "done", "done! again"));
    }

    #[test]
    fn prune_removes_stale_sessions() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        tracker.should_ws_notify_phrase("s2", "done", "done!");
        tracker.prune(&HashSet::from(["s2".to_string()]));
        // s1 の検出時刻は消えているので、再検出扱いになり即座には通知しない
        let (push, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 100.5, 20.0);
        assert!(!push);
    }
}
