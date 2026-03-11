export interface MentionOption {
  id: string;
  name: string;
  kind?: "agent" | "project";
  projectId?: string;
  projectColor?: string | null;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  onBlur?: () => void;
  imageUploadHandler?: (file: File) => Promise<string>;
  bordered?: boolean;
  /** List of mentionable entities. Enables @-mention autocomplete. */
  mentions?: MentionOption[];
  /** Called on Cmd/Ctrl+Enter */
  onSubmit?: () => void;
}

export interface MarkdownEditorRef {
  focus: () => void;
}
