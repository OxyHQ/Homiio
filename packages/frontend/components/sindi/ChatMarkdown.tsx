import React from 'react';
import { Linking, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { sindiStyles } from './styles';

/**
 * Hermes-friendly markdown renderer for Sindi chat messages.
 *
 * Deliberately hand-rolled (rather than a markdown library) so it stays fast on
 * Hermes and renders to native `<Text>`/`<View>` without an HTML layer. Supports
 * the subset the assistant actually emits: headings (`#`/`##`/`###`), bold
 * (`**…**`), inline code (`` `…` ``), fenced code blocks, ordered/unordered
 * lists, blockquotes, and inline links (`[label](https://…)`).
 *
 * Pure functions (`renderInlineSpans`/`renderMarkdownNodes`) do the parsing so
 * the component is a thin, memoized wrapper.
 */

type ChatRole = 'user' | 'assistant';

/** Resolve the role-specific text color style. */
function roleTextStyle(role: ChatRole): StyleProp<TextStyle> {
  return role === 'user' ? sindiStyles.userText : sindiStyles.assistantText;
}

const INLINE_CODE_REGEX = /(`[^`]+`)/g;
const INLINE_CODE_MATCH = /^`([^`]+)`$/;
const INLINE_BOLD_REGEX = /(\*\*[^*]+\*\*)/g;
const INLINE_BOLD_MATCH = /^\*\*([^*]+)\*\*$/;
const INLINE_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

const CODE_FENCE_REGEX = /^```\s*(\w+)?\s*$/;
const TRAILING_WHITESPACE_REGEX = /\s+$/;
const UNORDERED_LIST_REGEX = /^[-*]\s+(.*)$/;
const ORDERED_LIST_REGEX = /^(\d+)\.\s+(.*)$/;

/**
 * Render inline spans within a single line: inline code, then bold, then links,
 * falling through to plain text. Returns an array of `<Text>` nodes.
 */
function renderInlineSpans(
  text: string,
  baseStyle: StyleProp<TextStyle>,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  text.split(INLINE_CODE_REGEX).forEach((segment, i) => {
    const codeMatch = segment.match(INLINE_CODE_MATCH);
    if (codeMatch) {
      nodes.push(
        <Text key={`${keyPrefix}-code-${i}`} style={[baseStyle, sindiStyles.codeInline]}>
          {codeMatch[1]}
        </Text>,
      );
      return;
    }
    if (!segment) return;

    segment.split(INLINE_BOLD_REGEX).forEach((boldSegment, j) => {
      const boldMatch = boldSegment.match(INLINE_BOLD_MATCH);
      if (boldMatch) {
        nodes.push(
          <Text key={`${keyPrefix}-bold-${i}-${j}`} style={[baseStyle, sindiStyles.markdownBold]}>
            {boldMatch[1]}
          </Text>,
        );
        return;
      }
      if (!boldSegment) return;

      let lastIndex = 0;
      let match: RegExpExecArray | null;
      INLINE_LINK_REGEX.lastIndex = 0;
      while ((match = INLINE_LINK_REGEX.exec(boldSegment)) !== null) {
        const [full, label, url] = match;
        const before = boldSegment.substring(lastIndex, match.index);
        if (before) {
          nodes.push(
            <Text key={`${keyPrefix}-txt-${i}-${j}-${lastIndex}`} style={baseStyle}>
              {before}
            </Text>,
          );
        }
        nodes.push(
          <Text
            key={`${keyPrefix}-lnk-${i}-${j}-${match.index}`}
            style={[baseStyle, sindiStyles.link]}
            onPress={() => {
              Linking.openURL(url);
            }}
            suppressHighlighting
          >
            {label}
          </Text>,
        );
        lastIndex = match.index + full.length;
      }
      const rest = boldSegment.substring(lastIndex);
      if (rest) {
        nodes.push(
          <Text key={`${keyPrefix}-rest-${i}-${j}-${lastIndex}`} style={baseStyle}>
            {rest}
          </Text>,
        );
      }
    });
  });

  return nodes;
}

/** Parse a full markdown string into a list of block-level React nodes. */
function renderMarkdownNodes(content: string, role: ChatRole): React.ReactNode[] {
  if (!content) return [];

  const lines = content.split('\n');
  const out: React.ReactNode[] = [];
  const baseTextStyle: StyleProp<TextStyle> = [sindiStyles.markdownParagraph, roleTextStyle(role)];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const flushCode = (key: string): void => {
    if (codeBuffer.length === 0) return;
    const codeText = codeBuffer.join('\n');
    out.push(
      <View key={`code-${key}`} style={sindiStyles.codeBlock}>
        <Text style={[sindiStyles.codeText, roleTextStyle(role)]}>{codeText}</Text>
      </View>,
    );
    codeBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.replace(TRAILING_WHITESPACE_REGEX, '');
    const key = `ln-${i}`;

    if (CODE_FENCE_REGEX.test(line)) {
      if (!inCodeBlock) {
        inCodeBlock = true;
      } else {
        inCodeBlock = false;
        flushCode(key);
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      out.push(<View key={`sp-${key}`} style={sindiStyles.markdownSpacer} />);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      out.push(
        <Text key={key} style={[sindiStyles.markdownH1, roleTextStyle(role)]}>
          {trimmed.substring(2)}
        </Text>,
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      out.push(
        <Text key={key} style={[sindiStyles.markdownH2, roleTextStyle(role)]}>
          {trimmed.substring(3)}
        </Text>,
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      out.push(
        <Text key={key} style={[sindiStyles.markdownH3, roleTextStyle(role)]}>
          {trimmed.substring(4)}
        </Text>,
      );
      continue;
    }

    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      const text = trimmed.substring(2, trimmed.length - 2);
      const style: StyleProp<TextStyle> = [sindiStyles.markdownBold, roleTextStyle(role)];
      out.push(
        <Text key={key} style={style}>
          {renderInlineSpans(text, style, `${key}-bold`)}
        </Text>,
      );
      continue;
    }

    const ulMatch = trimmed.match(UNORDERED_LIST_REGEX);
    if (ulMatch) {
      const style: StyleProp<TextStyle> = [sindiStyles.markdownListItem, roleTextStyle(role)];
      out.push(
        <Text key={key} style={style}>
          {'• '}
          {renderInlineSpans(ulMatch[1], style, `${key}-li`)}
        </Text>,
      );
      continue;
    }

    const olMatch = trimmed.match(ORDERED_LIST_REGEX);
    if (olMatch) {
      const style: StyleProp<TextStyle> = [sindiStyles.markdownListItem, roleTextStyle(role)];
      out.push(
        <Text key={key} style={style}>
          {olMatch[1]}
          {'. '}
          {renderInlineSpans(olMatch[2], style, `${key}-ol`)}
        </Text>,
      );
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const style: StyleProp<TextStyle> = [sindiStyles.markdownBlockquote, roleTextStyle(role)];
      out.push(
        <Text key={key} style={style}>
          {renderInlineSpans(trimmed.substring(2), style, `${key}-bq`)}
        </Text>,
      );
      continue;
    }

    out.push(
      <Text key={key} style={baseTextStyle}>
        {renderInlineSpans(trimmed, baseTextStyle, `${key}-p`)}
      </Text>,
    );
  }

  if (inCodeBlock) flushCode('eof');

  return out;
}

export interface ChatMarkdownProps {
  content: string;
  role: ChatRole;
}

/**
 * Render markdown chat content. Wrapped in `React.memo` so a streaming sibling
 * message does not force already-rendered bubbles to re-parse their markdown.
 */
export const ChatMarkdown = React.memo<ChatMarkdownProps>(({ content, role }) => {
  return <>{renderMarkdownNodes(content, role)}</>;
});
ChatMarkdown.displayName = 'ChatMarkdown';
