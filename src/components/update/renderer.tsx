import "@blocknote/react/style.css";
import "@/styles/editor.css";
import { sanitizeUpdateHtml } from "@/lib/sanitize-update-html";

type UpdatesEditorProps = {
  html: string;
};

const UpdateRenderer = ({ html }: UpdatesEditorProps) => {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by sanitizeUpdateHtml
  return <div dangerouslySetInnerHTML={{ __html: sanitizeUpdateHtml(html) }} />;
};

export default UpdateRenderer;
