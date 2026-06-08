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
}

