'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertCodeBlock,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const previousValue = useRef(value);
  const [darkTheme, setDarkTheme] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setDarkTheme(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    if (editorRef.current?.getMarkdown() !== value) {
      editorRef.current?.setMarkdown(value);
    }
  }, [value]);

  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background text-foreground [&_.mdxeditor-toolbar]:max-w-full [&_.mdxeditor-toolbar]:flex-wrap [&_.mdxeditor-toolbar]:gap-1">
      <MDXEditor
        ref={editorRef}
        className={`${darkTheme ? 'dark-theme' : ''} min-w-0`}
        contentEditableClassName="min-h-[45vh] px-4 py-3 text-base leading-7 outline-none [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4"
        markdown={value}
        onChange={onChange}
        placeholder="Опиши результат, блокер и следующий шаг…"
        plugins={[
          headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          codeBlockPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => <>
              <UndoRedo />
              <Separator />
              <BlockTypeSelect />
              <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
              <ListsToggle options={['bullet', 'number']} />
              <CreateLink />
              <InsertCodeBlock />
            </>,
          }),
        ]}
      />
    </div>
  );
}
