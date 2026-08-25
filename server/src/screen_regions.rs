//! 画面キャプチャからのリージョン切り出し（herdr manifest.rs の移植 —
//! `screen_manifest.rs` から分離）。`ManifestStore` にも TOML にも依存しない
//! `&str → String` の純関数群。

use std::sync::OnceLock;

use regex::Regex;

// ─── リージョン切り出し（herdr manifest.rs の移植） ─────────────────────────

/// Rust の `str::lines()` 相当（末尾改行後の空要素を作らず、`\r` を除去）。
pub(crate) fn split_lines(text: &str) -> Vec<&str> {
    let mut raw: Vec<&str> = text.split('\n').collect();
    if raw.last() == Some(&"") {
        raw.pop();
    }
    raw.into_iter()
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

pub fn is_horizontal_rule(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let mut rule_chars = 0usize;
    for ch in trimmed.chars() {
        if ch == '─' {
            rule_chars += 1;
        } else {
            break;
        }
    }
    if rule_chars == 0 {
        return false;
    }
    let suffix: String = trimmed.chars().skip(rule_chars).collect();
    let suffix = suffix.trim_start();
    suffix.is_empty() || rule_chars >= 3
}

fn bottom_non_empty_lines(lines: &[&str], count: usize) -> String {
    let mut start: Option<usize> = None;
    let mut remaining = count;
    for i in (0..lines.len()).rev() {
        if !lines[i].trim().is_empty() {
            start = Some(i);
            remaining = remaining.saturating_sub(1);
            if remaining == 0 {
                break;
            }
        }
    }
    match start {
        Some(start) => lines[start..].join("\n"),
        None => String::new(),
    }
}

fn after_last_horizontal_rule(lines: &[&str]) -> String {
    let mut last: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if is_horizontal_rule(line) {
            last = Some(i);
        }
    }
    let start = last.map(|i| i + 1).unwrap_or(0);
    lines[start..].join("\n")
}

fn prompt_box_top_border_index(lines: &[&str]) -> Option<usize> {
    let mut border_count = 0;
    for i in (0..lines.len()).rev() {
        if is_horizontal_rule(lines[i]) {
            border_count += 1;
            if border_count == 2 {
                return Some(i);
            }
        }
    }
    None
}

fn prompt_box_body(lines: &[&str]) -> String {
    let Some(top) = prompt_box_top_border_index(lines) else {
        return String::new();
    };
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(top + 1) {
        if is_horizontal_rule(line) {
            end = i;
            break;
        }
    }
    lines[top + 1..end].join("\n")
}

fn codex_prompt_line(line: &str) -> bool {
    line == "›" || line.starts_with("› ")
}

fn after_last_prompt_marker(lines: &[&str], content: &str) -> String {
    let mut index = None;
    for i in (0..lines.len()).rev() {
        if codex_prompt_line(lines[i]) {
            index = Some(i);
            break;
        }
    }
    match index {
        Some(index) => lines[index + 1..].join("\n"),
        None => content.to_string(),
    }
}

fn bottom_lines(lines: &[&str], count: usize) -> String {
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

fn top_non_empty_lines(lines: &[&str], count: usize) -> String {
    let mut end: Option<usize> = None;
    let mut remaining = count;
    for (i, line) in lines.iter().enumerate() {
        if !line.trim().is_empty() {
            end = Some(i);
            remaining = remaining.saturating_sub(1);
            if remaining == 0 {
                break;
            }
        }
    }
    match end {
        Some(end) => lines[..=end].join("\n"),
        None => String::new(),
    }
}

pub(crate) fn region_count_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(bottom_non_empty_lines|bottom_lines|top_non_empty_lines)\((\d+)\)$")
            .expect("valid regex")
    })
}

/// ルールの region 指定に対応するテキストを返す。未実装リージョンは空文字。
pub fn region_text(region: &str, screen: &str, osc_title: &str, osc_progress: &str) -> String {
    match region {
        "osc_title" => return osc_title.to_string(),
        "osc_progress" => return osc_progress.to_string(),
        "whole_recent" => return screen.to_string(),
        _ => {}
    }
    let lines = split_lines(screen);
    match region {
        "after_last_horizontal_rule" => return after_last_horizontal_rule(&lines),
        "prompt_box_body" => return prompt_box_body(&lines),
        "after_last_prompt_marker" => return after_last_prompt_marker(&lines, screen),
        _ => {}
    }
    if let Some(caps) = region_count_re().captures(region) {
        let count: usize = caps[2].parse().unwrap_or(0);
        return match &caps[1] {
            "bottom_non_empty_lines" => bottom_non_empty_lines(&lines, count),
            "bottom_lines" => bottom_lines(&lines, count),
            _ => top_non_empty_lines(&lines, count),
        };
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── is_horizontal_rule ──────────────────────────────────────────────

    #[test]
    fn rule_line() {
        assert!(is_horizontal_rule("────────"));
    }

    #[test]
    fn rule_with_suffix_needs_three_chars() {
        assert!(is_horizontal_rule("─── title"));
        assert!(!is_horizontal_rule("─ title"));
    }

    #[test]
    fn non_rule_lines() {
        assert!(!is_horizontal_rule(""));
        assert!(!is_horizontal_rule("  hello"));
    }

    // ─── region_text ─────────────────────────────────────────────────────

    #[test]
    fn whole_recent_returns_screen() {
        assert_eq!(region_text("whole_recent", "a\nb", "t", "p"), "a\nb");
    }

    #[test]
    fn osc_regions_use_dedicated_inputs() {
        assert_eq!(region_text("osc_title", "screen", "title", "prog"), "title");
        assert_eq!(
            region_text("osc_progress", "screen", "title", "prog"),
            "prog"
        );
    }

    #[test]
    fn bottom_non_empty_lines_includes_trailing_blanks() {
        let screen = "one\ntwo\n\nthree\n\n";
        assert_eq!(
            region_text("bottom_non_empty_lines(2)", screen, "", ""),
            "two\n\nthree\n"
        );
    }

    #[test]
    fn bottom_non_empty_lines_empty_screen() {
        assert_eq!(region_text("bottom_non_empty_lines(3)", "\n\n", "", ""), "");
    }

    #[test]
    fn after_last_horizontal_rule_test() {
        let screen = "output\n────\nprompt line\nmore";
        assert_eq!(
            region_text("after_last_horizontal_rule", screen, "", ""),
            "prompt line\nmore"
        );
    }

    #[test]
    fn after_last_horizontal_rule_without_rule_returns_all() {
        assert_eq!(
            region_text("after_last_horizontal_rule", "a\nb", "", ""),
            "a\nb"
        );
    }

    #[test]
    fn prompt_box_body_between_borders() {
        let screen = "output\n────\n❯ draft text\n────\nhint";
        assert_eq!(
            region_text("prompt_box_body", screen, "", ""),
            "❯ draft text"
        );
    }

    #[test]
    fn prompt_box_body_requires_two_borders() {
        assert_eq!(region_text("prompt_box_body", "────\ntext", "", ""), "");
    }

    #[test]
    fn after_last_prompt_marker_test() {
        let screen = "old\n› question\nanswer area";
        assert_eq!(
            region_text("after_last_prompt_marker", screen, "", ""),
            "answer area"
        );
    }

    #[test]
    fn after_last_prompt_marker_without_marker_returns_all() {
        assert_eq!(
            region_text("after_last_prompt_marker", "a\nb", "", ""),
            "a\nb"
        );
    }

    #[test]
    fn top_non_empty_lines_includes_leading_blanks() {
        let screen = "\nfirst\nsecond\nthird";
        assert_eq!(
            region_text("top_non_empty_lines(2)", screen, "", ""),
            "\nfirst\nsecond"
        );
    }

    #[test]
    fn top_non_empty_lines_empty_screen() {
        assert_eq!(region_text("top_non_empty_lines(1)", "\n\n", "", ""), "");
    }

    #[test]
    fn bottom_lines_counts_raw_lines() {
        assert_eq!(region_text("bottom_lines(2)", "a\nb\nc\n", "", ""), "b\nc");
    }

    #[test]
    fn unknown_region_is_empty() {
        assert_eq!(region_text("osc_hyperlink", "screen", "t", "p"), "");
    }
}
