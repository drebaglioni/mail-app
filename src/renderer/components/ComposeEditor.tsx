import { useEditor, EditorContent } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { EditorView } from "@tiptap/pm/view";

// Extract Editor type from useEditor return type
type Editor = NonNullable<ReturnType<typeof useEditor>>;
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import DOMPurify from "dompurify";
import { useAppStore } from "../store";
import { ContactMention } from "./MentionSuggestion";
import type { Snippet } from "../../shared/types";

interface ComposeEditorProps {
  initialContent?: string;
  quotedContent?: string; // Raw HTML of quoted email - rendered separately, not editable
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Called when a contact is selected via @mention or +mention in the body */
  onAddToCc?: (email: string) => void;
  /** Recipient email for snippet variable resolution */
  recipientEmail?: string;
}

/**
 * Read a File as a data URI string.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Inline snippet suggestion (Superhuman-style, triggered by ;) ---

interface SnippetListProps {
  items: Snippet[];
  command: (item: Snippet) => void;
}

interface SnippetListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SnippetList = forwardRef<SnippetListRef, SnippetListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className="exo-elevated border exo-border-subtle rounded-lg shadow-lg dark:shadow-xl dark:shadow-black/50 max-h-60 overflow-y-auto z-50">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={`px-3 py-2 cursor-pointer text-sm ${
            index === selectedIndex
              ? "bg-[var(--exo-accent-soft)]"
              : "hover:bg-[var(--exo-bg-surface-hover)]"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            selectItem(index);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium exo-text-primary truncate text-xs">{item.name}</span>
            <span className="text-[10px] exo-text-muted shrink-0">Me</span>
          </div>
          <p className="text-[11px] exo-text-muted truncate">{stripHtmlPreview(item.body)}</p>
        </div>
      ))}
    </div>
  );
});

SnippetList.displayName = "SnippetList";

function stripHtmlPreview(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim().substring(0, 100);
}

const snippetPluginKey = new PluginKey("snippetSuggestion");

interface SnippetContext {
  snippets: Snippet[];
  recipientEmail?: string;
  senderName?: string;
}

interface SnippetMentionOptions {
  contextRef: React.RefObject<SnippetContext>;
}

const SnippetMention = Extension.create<SnippetMentionOptions>({
  name: "snippetMention",

  addOptions() {
    return {
      contextRef: { current: { snippets: [] } },
    };
  },

  addProseMirrorPlugins() {
    const { contextRef } = this.options;

    const suggestionConfig: Omit<SuggestionOptions<Snippet>, "editor"> = {
      char: ";",
      pluginKey: snippetPluginKey,
      // Only trigger after whitespace or at the start of a line (not mid-word like "review this;")
      allowedPrefixes: [" "],
      items: ({ query }): Snippet[] => {
        const all = contextRef.current?.snippets ?? [];
        if (!query) return all;
        const q = query.toLowerCase();
        return all.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.shortcut && s.shortcut.toLowerCase().includes(q)),
        );
      },

      command: ({ editor, range, props: snippet }) => {
        const ctx = contextRef.current;
        const resolved = resolveSnippetVariables(
          snippet.body,
          ctx?.recipientEmail,
          ctx?.senderName,
        );
        // Check if the body is HTML BEFORE sanitizing — plain text bodies
        // would have angle brackets stripped by DOMPurify
        const isHtml = /<[a-z][\s\S]*>/i.test(resolved);
        let content: string;
        if (isHtml) {
          const sanitized = DOMPurify.sanitize(resolved);
          content = sanitized
            .replace(/<br\s*\/?>\s*<\/div>/gi, "</div>")
            .replace(/<div>\s*<\/div>/gi, "<p></p>");
        } else {
          // Plain text: escape HTML chars and convert newlines to <br>
          content = escapeHtml(resolved).replace(/\n/g, "<br>");
        }
        editor.chain().focus().deleteRange(range).insertContent(content).run();
      },

      render: () => {
        let component: ReactRenderer<SnippetListRef, SnippetListProps>;
        let popup: TippyInstance[];

        return {
          onStart: (props: SuggestionProps<Snippet>) => {
            component = new ReactRenderer(SnippetList, {
              props: { items: props.items, command: props.command },
              editor: props.editor,
            });

            if (!props.clientRect) return;

            popup = tippy("body", {
              getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: "manual",
              placement: "bottom-start",
            });
          },

          onUpdate: (props: SuggestionProps<Snippet>) => {
            component?.updateProps({
              items: props.items,
              command: props.command,
            });

            if (!props.clientRect || !popup?.[0]) return;

            popup[0].setProps({
              getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
            });
          },

          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event.key === "Escape") {
              return false;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit: () => {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    };

    return [
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
      }),
    ];
  },
});

/** Escape plain text for safe injection into HTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Resolve snippet variables:
 * - {first_name} → recipient's first name
 * - {my_name} → sender's display name
 * - {custom_var} → prompt user
 */
function resolveSnippetVariables(
  body: string,
  recipientEmail?: string,
  senderName?: string,
): string {
  let resolved = body;

  // Resolve {my_name} — use replacer function to avoid $-pattern interpretation
  if (senderName) {
    resolved = resolved.replace(/\{my_name\}/gi, () => senderName);
  }

  // Resolve {first_name} from recipient email (best effort: take part before @, capitalize)
  if (recipientEmail) {
    const localPart = recipientEmail.split("@")[0] || "";
    const firstName = localPart.split(/[._-]/)[0];
    const capitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    resolved = resolved.replace(/\{first_name\}/gi, () => capitalized);
  }

  // Custom placeholders like {inviter}, {action_item_1} are left as-is
  // so the user can fill them in directly in the editor after insertion.
  // This avoids blocking window.prompt() dialogs.

  return resolved;
}

export function ComposeEditor({
  initialContent = "",
  quotedContent,
  onChange,
  placeholder = "Write your message...",
  className = "",
  autoFocus = false,
  onAddToCc,
  recipientEmail,
}: ComposeEditorProps) {
  const isDark = useAppStore((s) => s.resolvedTheme) === "dark";
  const snippets = useAppStore((s) => s.snippets);
  const currentAccountId = useAppStore((s) => s.currentAccountId);
  const accounts = useAppStore((s) => s.accounts);
  const accountSnippets = snippets.filter((s) => s.accountId === currentAccountId);
  const currentAccountRecord = accounts.find((a) => a.id === currentAccountId);
  const senderName =
    currentAccountRecord?.displayName || currentAccountRecord?.email?.split("@")[0];

  // Ref keeps the latest onAddToCc without recreating extensions
  const onAddToCcRef = useRef<((email: string) => void) | null>(onAddToCc ?? null);
  useEffect(() => {
    onAddToCcRef.current = onAddToCc ?? null;
  }, [onAddToCc]);

  // Stable ref object for the extension (created once)
  const stableRef = useMemo(() => onAddToCcRef, []);

  // Snippet suggestion context (stable ref, extension reads latest via ref)
  const snippetContextRef = useRef<SnippetContext>({
    snippets: accountSnippets,
    recipientEmail,
    senderName,
  });
  useEffect(() => {
    snippetContextRef.current = { snippets: accountSnippets, recipientEmail, senderName };
  }, [accountSnippets, recipientEmail, senderName]);
  const stableContextRef = useMemo(() => snippetContextRef, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: false, // Link is configured explicitly below
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "exo-accent-text underline",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          style: "max-width: 100%; height: auto;",
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      TextAlign.configure({
        types: ["paragraph"],
      }),
      ContactMention.configure({
        onAddToCcRef: stableRef,
      }),
      SnippetMention.configure({
        contextRef: stableContextRef,
      }),
    ],
    content: initialContent,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "text-sm leading-relaxed max-w-none focus:outline-none min-h-[100px] p-3 exo-text-primary",
      },
      // Handle paste and drop of images
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        const imageFiles: File[] = [];
        for (const item of Array.from(items)) {
          if (!item.type.startsWith("image/")) continue;
          const file = item.getAsFile();
          if (!file || file.size > 10 * 1024 * 1024) continue;
          imageFiles.push(file);
        }
        if (imageFiles.length === 0) return false;

        event.preventDefault();
        // Capture position before async work to avoid stale state
        const insertPos = view.state.selection.from;
        Promise.all(
          imageFiles.map((file) =>
            readFileAsDataUrl(file).then((dataUrl) => ({ dataUrl, name: file.name })),
          ),
        ).then((images) => {
          let tr = view.state.tr;
          let pos = insertPos;
          for (const img of images) {
            const node = view.state.schema.nodes.image.create({ src: img.dataUrl, alt: img.name });
            tr = tr.insert(pos, node);
            pos += node.nodeSize;
          }
          view.dispatch(tr);
        });
        return true;
      },
      handleDrop: (view: EditorView, event: DragEvent) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter(
          (f: File) => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024,
        );
        if (imageFiles.length === 0) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

        // Resolve all files first, then insert in a single transaction to avoid stale positions
        Promise.all(
          imageFiles.map((file) =>
            readFileAsDataUrl(file).then((dataUrl) => ({ dataUrl, name: file.name })),
          ),
        ).then((images) => {
          let tr = view.state.tr;
          let insertPos = pos?.pos ?? view.state.selection.from;
          for (const img of images) {
            const node = view.state.schema.nodes.image.create({ src: img.dataUrl, alt: img.name });
            tr = tr.insert(insertPos, node);
            insertPos += node.nodeSize;
          }
          view.dispatch(tr);
        });
        return true;
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();
      onChange(html, text);
    },
  });

  // Update content when initialContent changes (for editing drafts)
  useEffect(() => {
    if (editor && initialContent !== editor.getHTML()) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor]);

  return (
    <div className={className}>
      <div className="text-[var(--exo-text-primary)]">
        <EditorContent editor={editor} />
      </div>
      {/* Quoted content rendered as non-editable HTML */}
      {quotedContent && (
        <div className="border-t exo-border-subtle">
          <div
            className="p-3 text-sm exo-text-secondary exo-surface-soft"
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {/* Use an iframe to safely render the original email HTML with all its styles */}
            <iframe
              srcDoc={`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      font-size: 14px;
                      line-height: 1.5;
                      color: ${isDark ? "#eaf0ff" : "#0b1220"};
                      background: ${isDark ? "#0e1526" : "transparent"};
                      margin: 0;
                      padding: 0;
                    }
                    blockquote {
                      border-left: 2px solid ${isDark ? "#34466b" : "#d7dfec"};
                      margin: 8px 0;
                      padding-left: 12px;
                      color: ${isDark ? "#a6b4d3" : "#4f5f7a"};
                    }
                    img { max-width: 100%; height: auto; }
                    a { color: ${isDark ? "#5b83ff" : "#2155ff"}; }
                  </style>
                </head>
                <body>${quotedContent}</body>
                </html>
              `}
              title="Quoted content"
              className="w-full border-0"
              style={{ minHeight: "150px", height: "auto" }}
              sandbox="allow-same-origin"
              onLoad={(e) => {
                // Auto-resize iframe to fit content
                const iframe = e.target as HTMLIFrameElement;
                if (iframe.contentDocument) {
                  const height = iframe.contentDocument.body.scrollHeight;
                  iframe.style.height = `${Math.min(height + 20, 400)}px`;
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ComposeEditor;
