//! 前面プロセスの argv とジョブ定義コマンドの照合（Python 側 `api/job_match.py`
//! の移植）。
//!
//! 素のターミナルで手打ちされたコマンドがジョブ定義と一致するかを判定する。
//! 一致したセッションにはジョブメタデータ（TMUX_JOB_NAME 等）が刻印され、
//! notify_phrase・アイコン表示など既存のジョブ機構がそのまま有効になる
//! （agent_watch から呼ばれる）。
//!
//! 照合規則（設計判断は ADR 31 参照）:
//!
//! - ジョブコマンドをコメント行除去 → 改行・`&&`・`;` でステップ分割 →
//!   空白正規化して、各ステップを照合パターンにする
//! - `[[var]]` プレースホルダはワイルドカード（1 個以上の任意文字列）にする
//! - 前面グループのいずれかのプロセスの argv（空白正規化した文字列）と
//!   ステップの**完全一致のみ**採用する。前方一致は `npm` 始まりのジョブ同士で
//!   衝突するため使わない
//! - 誤検知の実害は「セッションにジョブラベルが付く」に閉じる（fail-safe）

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value};

use crate::state::AppState;

fn placeholder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[\s*[A-Za-z0-9_]+\s*\]\]").expect("valid regex"))
}

fn comment_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*#").expect("valid regex"))
}

fn step_split_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"&&|;|\n").expect("valid regex"))
}

pub struct JobPattern {
    pub name: String,
    pub steps: Vec<Regex>,
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// ジョブコマンドを照合単位のステップ（正規化済み文字列）に分割する。
pub fn command_steps(command: &str) -> Vec<String> {
    let joined = command
        .lines()
        .filter(|line| !comment_line_re().is_match(line))
        .collect::<Vec<_>>()
        .join("\n");
    step_split_re()
        .split(&joined)
        .map(normalize_text)
        .filter(|s| !s.is_empty())
        .collect()
}

/// ステップ文字列を照合用の fullmatch 正規表現へ変換する。
///
/// `[[var]]` はワイルドカード、それ以外はリテラル。空白は正規化済み前提。
pub fn step_to_pattern(step: &str) -> Regex {
    let mut pattern = String::from(r"\A");
    let mut last = 0;
    for m in placeholder_re().find_iter(step) {
        pattern.push_str(&regex::escape(&step[last..m.start()]));
        pattern.push_str(".+?");
        last = m.end();
    }
    pattern.push_str(&regex::escape(&step[last..]));
    pattern.push_str(r"\z");
    Regex::new(&pattern).expect("escaped pattern is always valid")
}

/// ジョブ定義群を照合パターンへ変換する（コマンドの無いジョブは除外）。
///
/// `jobs` は名前 → ジョブエントリ（`"command"` フィールドを含む dict）。
pub fn build_job_patterns(jobs: &Map<String, Value>) -> Vec<JobPattern> {
    let mut patterns = Vec::new();
    for (name, entry) in jobs {
        let command = entry.get("command").and_then(Value::as_str).unwrap_or("");
        let steps = command_steps(command);
        if steps.is_empty() {
            continue;
        }
        patterns.push(JobPattern {
            name: name.clone(),
            steps: steps.iter().map(|s| step_to_pattern(s)).collect(),
        });
    }
    patterns
}

/// 前面プロセスの argv 一覧とジョブパターンを照合する（完全一致のみ）。
pub fn match_job<'a>(argvs: &[Vec<String>], patterns: &'a [JobPattern]) -> Option<&'a JobPattern> {
    if argvs.is_empty() || patterns.is_empty() {
        return None;
    }
    let texts: Vec<String> = argvs
        .iter()
        .filter(|argv| !argv.is_empty())
        .map(|argv| normalize_text(&argv.join(" ")))
        .collect();
    for pattern in patterns {
        for step in &pattern.steps {
            if texts.iter().any(|t| step.is_match(t)) {
                return Some(pattern);
            }
        }
    }
    None
}

/// セッションの照合対象ジョブを返す。
///
/// ワークスペース紐付きならワークスペース + 共通ジョブ、素のターミナルは
/// 共通ジョブのみ。読み込みは jobs_common の TTL キャッシュに乗る。
pub fn candidate_jobs(state: &AppState, workspace: Option<&str>) -> Map<String, Value> {
    match workspace {
        Some(ws) if !ws.is_empty() => crate::jobs_common::serialize_workspace_jobs(state, ws),
        _ => crate::jobs_common::load_common_jobs_data(state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterns(commands: &[(&str, &str)]) -> Vec<JobPattern> {
        let mut jobs = Map::new();
        for (name, command) in commands {
            jobs.insert(
                (*name).to_string(),
                serde_json::json!({"command": command, "label": name}),
            );
        }
        build_job_patterns(&jobs)
    }

    #[test]
    fn splits_on_and_and_semicolon_and_newline() {
        assert_eq!(
            command_steps("cd sub && npm run dev"),
            vec!["cd sub".to_string(), "npm run dev".to_string()]
        );
        assert_eq!(
            command_steps("a; b\nc"),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn strips_comment_lines_and_blank_steps() {
        assert_eq!(
            command_steps("# comment\nnpm test\n\n"),
            vec!["npm test".to_string()]
        );
    }

    #[test]
    fn normalizes_whitespace() {
        assert_eq!(
            command_steps("npm   run\tdev"),
            vec!["npm run dev".to_string()]
        );
    }

    #[test]
    fn placeholder_becomes_wildcard() {
        let pattern = step_to_pattern("git checkout [[branch]]");
        assert!(pattern.is_match("git checkout feature/x"));
        assert!(!pattern.is_match("git checkout"));
    }

    #[test]
    fn literal_regex_chars_are_escaped() {
        let pattern = step_to_pattern("echo a.b*");
        assert!(pattern.is_match("echo a.b*"));
        assert!(!pattern.is_match("echo aXbY"));
    }

    #[test]
    fn exact_match_only() {
        let patterns = patterns(&[("dev", "npm run dev")]);
        assert_eq!(
            match_job(&[vec!["npm".into(), "run".into(), "dev".into()]], &patterns)
                .map(|p| &p.name[..]),
            Some("dev")
        );
        // 前方一致・部分一致は採用しない
        assert!(match_job(
            &[vec!["npm".into(), "run".into(), "dev:watch".into()]],
            &patterns
        )
        .is_none());
        assert!(match_job(&[vec!["npm".into(), "run".into()]], &patterns).is_none());
    }

    #[test]
    fn any_process_in_group_can_match() {
        let patterns = patterns(&[("dev", "npm run dev")]);
        let argvs = vec![
            vec!["node".to_string(), "/usr/lib/vite".to_string()],
            vec!["npm".to_string(), "run".to_string(), "dev".to_string()],
        ];
        assert_eq!(
            match_job(&argvs, &patterns).map(|p| &p.name[..]),
            Some("dev")
        );
    }

    #[test]
    fn multi_step_command_matches_by_step() {
        let patterns = patterns(&[("dev", "cd sub && npm run dev")]);
        assert_eq!(
            match_job(&[vec!["npm".into(), "run".into(), "dev".into()]], &patterns)
                .map(|p| &p.name[..]),
            Some("dev")
        );
    }

    #[test]
    fn placeholder_command() {
        let patterns = patterns(&[("co", "git checkout [[branch]]")]);
        assert_eq!(
            match_job(
                &[vec!["git".into(), "checkout".into(), "main".into()]],
                &patterns
            )
            .map(|p| &p.name[..]),
            Some("co")
        );
    }

    #[test]
    fn empty_inputs() {
        let patterns = patterns(&[("dev", "npm run dev")]);
        assert!(match_job(&[], &patterns).is_none());
        assert!(match_job(&[vec!["npm".into(), "run".into(), "dev".into()]], &[]).is_none());
    }

    #[test]
    fn jobs_without_command_are_excluded() {
        let patterns = patterns(&[("empty", ""), ("comment_only", "# note")]);
        assert!(patterns.is_empty());
    }
}
