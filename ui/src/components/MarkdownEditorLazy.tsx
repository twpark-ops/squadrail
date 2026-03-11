import { Suspense, forwardRef, lazy, useImperativeHandle, useRef } from "react";
import { cn } from "../lib/utils";
import type {
  MarkdownEditorProps,
  MarkdownEditorRef,
  MentionOption,
} from "./MarkdownEditor.types";

export type { MentionOption, MarkdownEditorProps, MarkdownEditorRef };

const MarkdownEditorImpl = lazy(async () =>
  Promise.all([
    import("@mdxeditor/editor/style.css"),
    import("./MarkdownEditor"),
  ]).then(([, module]) => ({
    default: module.MarkdownEditor,
  }))
);

export const MarkdownEditor = forwardRef<
  MarkdownEditorRef,
  MarkdownEditorProps
>(function MarkdownEditor(props, forwardedRef) {
  const innerRef = useRef<MarkdownEditorRef>(null);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => {
        innerRef.current?.focus();
      },
    }),
    []
  );

  return (
    <Suspense
      fallback={
        <div
          className={cn(
            "relative min-h-[220px] rounded-md border border-border bg-background/70",
            props.className
          )}
        >
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-sm text-muted-foreground">
            Loading editor...
          </div>
        </div>
      }
    >
      <MarkdownEditorImpl ref={innerRef} {...props} />
    </Suspense>
  );
});
