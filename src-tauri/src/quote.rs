/// Format selected text as a Markdown blockquote: every line gets a "> " prefix
/// and empty lines become a bare ">".
pub fn format_quote(text: &str) -> String {
    text.lines()
        .map(|line| {
            if line.is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format selected text as a `> [!quote]` clip callout: a callout header line
/// followed by the text as quoted body. FloatNote renders this as a callout card;
/// Obsidian renders it as a native callout. (No source URL is available from a
/// clipboard capture, so the header carries no title in v1.)
pub fn format_clip(text: &str) -> String {
    format!("> [!quote]\n{}", format_quote(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line() {
        assert_eq!(format_quote("hello"), "> hello");
    }

    #[test]
    fn multi_line() {
        assert_eq!(format_quote("a\nb"), "> a\n> b");
    }

    #[test]
    fn blank_line_in_middle() {
        assert_eq!(format_quote("a\n\nb"), "> a\n>\n> b");
    }

    #[test]
    fn trailing_newline_ignored() {
        assert_eq!(format_quote("a\n"), "> a");
    }

    #[test]
    fn existing_quote_marker_is_preserved_as_text() {
        assert_eq!(format_quote("> original"), "> > original");
    }

    #[test]
    fn clip_wraps_text_as_quote_callout() {
        assert_eq!(format_clip("hello"), "> [!quote]\n> hello");
    }

    #[test]
    fn clip_preserves_blank_lines_in_body() {
        assert_eq!(format_clip("a\n\nb"), "> [!quote]\n> a\n>\n> b");
    }
}

