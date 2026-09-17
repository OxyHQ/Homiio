import React from 'react';
import { Linking } from 'react-native';
import {
  AiChatBullet,
  AiChatBulletList,
  AiChatLinkChip,
  AiChatMessageLine,
  AiChatStrong,
} from '@oxy.so/bloom/ai-chat';
import { Code, CodeBlock, Pre } from '@oxy.so/bloom/code';
import { Blockquote, Text } from '@oxy.so/bloom/typography';

/**
 * Hermes-friendly markdown for Sindi replies, rendered as Bloom ai-chat blocks.
 *
 * Bloom ships no markdown parser (ai-chat takes pre-built `AiChatMessageLine`s,
 * agent-chat renders plain paragraphs), so the tiny line parser stays local and
 * only the OUTPUT is Bloom: paragraphs are `AiChatMessageLine`, bold is
 * `AiChatStrong`, links are `AiChatLinkChip`, inline code is `Code`, fenced
 * code is `CodeBlock` (JS/TS, highlighted) or `Pre`, bullet runs are one
 * `AiChatBulletList`, headings are the type ramp and quotes are `Blockquote`.
 *
 * `renderMarkdownBlocks` returns one node per block so an `AiChatAssistantMessage`
 * reveals each on its own beat; a block already on screen keeps its key while
 * the stream grows, so it never re-animates.
 */

const INLINE_CODE_REGEX = /(`[^`]+`)/g;
const INLINE_CODE_MATCH = /^`([^`]+)`$/;
const INLINE_BOLD_REGEX = /(\*\*[^*]+\*\*)/g;
const INLINE_BOLD_MATCH = /^\*\*([^*]+)\*\*$/;
const INLINE_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

const CODE_FENCE_REGEX = /^```\s*(\w+)?\s*$/;
const TRAILING_WHITESPACE_REGEX = /\s+$/;
const UNORDERED_LIST_REGEX = /^[-*]\s+(.*)$/;
const ORDERED_LIST_REGEX = /^(\d+)\.\s+(.*)$/;

/** Grammars Bloom's `CodeBlock` highlights; anything else renders in a plain `Pre`. */
const HIGHLIGHTED_LANGUAGES = new Set(['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript']);

/** Inline runs of one line: inline code, then bold, then links, then plain text. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  text.split(INLINE_CODE_REGEX).forEach((segment, i) => {
    const codeMatch = segment.match(INLINE_CODE_MATCH);
    if (codeMatch) {
      nodes.push(<Code key={`${keyPrefix}-code-${i}`}>{codeMatch[1]}</Code>);
      return;
    }
    if (!segment) return;

    segment.split(INLINE_BOLD_REGEX).forEach((boldSegment, j) => {
      const boldMatch = boldSegment.match(INLINE_BOLD_MATCH);
      if (boldMatch) {
        nodes.push(<AiChatStrong key={`${keyPrefix}-bold-${i}-${j}`}>{boldMatch[1]}</AiChatStrong>);
        return;
      }
      if (!boldSegment) return;

      let lastIndex = 0;
      let match: RegExpExecArray | null;
      INLINE_LINK_REGEX.lastIndex = 0;
      while ((match = INLINE_LINK_REGEX.exec(boldSegment)) !== null) {
        const [full, label, url] = match;
        const before = boldSegment.substring(lastIndex, match.index);
        if (before) nodes.push(before);
        nodes.push(
          <AiChatLinkChip
            key={`${keyPrefix}-lnk-${i}-${j}-${match.index}`}
            onPress={() => {
              Linking.openURL(url);
            }}
          >
            {label}
          </AiChatLinkChip>,
        );
        lastIndex = match.index + full.length;
      }
      const rest = boldSegment.substring(lastIndex);
      if (rest) nodes.push(rest);
    });
  });

  return nodes;
}

/** A fenced code block: highlighted card for JS/TS, a plain `Pre` otherwise. */
function renderCode(code: string, language: string | undefined, key: string): React.ReactNode {
  if (language && HIGHLIGHTED_LANGUAGES.has(language.toLowerCase())) {
    return <CodeBlock key={key} code={code} language={language} wrap />;
  }
  return <Pre key={key}>{code}</Pre>;
}

/** Parse a markdown string into Bloom ai-chat blocks, one node per block. */
export function renderMarkdownBlocks(content: string): React.ReactNode[] {
  if (!content) return [];

  const lines = content.split('\n');
  const out: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeLanguage: string | undefined;
  let codeBuffer: string[] = [];
  let bullets: { key: string; text: string }[] = [];

  const flushBullets = (): void => {
    if (bullets.length === 0) return;
    const first = bullets[0].key;
    out.push(
      <AiChatBulletList key={`ul-${first}`}>
        {bullets.map((bullet) => (
          <AiChatBullet key={bullet.key}>{renderInline(bullet.text, bullet.key)}</AiChatBullet>
        ))}
      </AiChatBulletList>,
    );
    bullets = [];
  };

  const flushCode = (key: string): void => {
    if (codeBuffer.length === 0) return;
    out.push(renderCode(codeBuffer.join('\n'), codeLanguage, `code-${key}`));
    codeBuffer = [];
    codeLanguage = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(TRAILING_WHITESPACE_REGEX, '');
    const key = `ln-${i}`;

    const fence = line.match(CODE_FENCE_REGEX);
    if (fence) {
      if (!inCodeBlock) {
        flushBullets();
        inCodeBlock = true;
        codeLanguage = fence[1];
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
    const ulMatch = trimmed.match(UNORDERED_LIST_REGEX);
    if (ulMatch) {
      bullets.push({ key, text: ulMatch[1] });
      continue;
    }
    flushBullets();

    // Blank lines only separate blocks; the message's own gap spaces them.
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      out.push(
        <AiChatMessageLine key={key} block>
          <Text variant="title-3-semibold">{trimmed.substring(2)}</Text>
        </AiChatMessageLine>,
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      out.push(
        <AiChatMessageLine key={key} block>
          <Text variant="headline-semibold">{trimmed.substring(3)}</Text>
        </AiChatMessageLine>,
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      out.push(
        <AiChatMessageLine key={key} block>
          <Text variant="body-semibold">{trimmed.substring(4)}</Text>
        </AiChatMessageLine>,
      );
      continue;
    }

    const olMatch = trimmed.match(ORDERED_LIST_REGEX);
    if (olMatch) {
      out.push(
        <AiChatMessageLine key={key}>
          {`${olMatch[1]}. `}
          {renderInline(olMatch[2], key)}
        </AiChatMessageLine>,
      );
      continue;
    }

    if (trimmed.startsWith('> ')) {
      out.push(
        <AiChatMessageLine key={key} block>
          <Blockquote style={{ marginTop: 0 }}>{renderInline(trimmed.substring(2), key)}</Blockquote>
        </AiChatMessageLine>,
      );
      continue;
    }

    out.push(<AiChatMessageLine key={key}>{renderInline(trimmed, key)}</AiChatMessageLine>);
  }

  flushBullets();
  if (inCodeBlock) flushCode('eof');

  return out;
}
