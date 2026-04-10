import { afterEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { setDefaultTabWidth } from "@oh-my-pi/pi-natives";
import { CURSOR_MARKER } from "@oh-my-pi/pi-tui";
import { CombinedAutocompleteProvider } from "@oh-my-pi/pi-tui/autocomplete";
import { Editor } from "@oh-my-pi/pi-tui/components/editor";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings";
import { defaultEditorTheme } from "./test-themes";

// Mock AI provider for editor suggestions
const mockAIProvider = {
  async getSuggestions(lines: string[], cursorLine: number, cursorCol: number) {
    return { items: [{ label: "/ai-suggest", value: "/ai-suggest" }], prefix: "/" };
  },
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
    return { lines, cursorLine, cursorCol };
  },
};

describe("Editor component", () => {
  afterEach(() => {
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
  });

  describe("AI-Assisted Editing", () => {
    it("triggers AI suggestion autocomplete when typing /ai", async () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setAutocompleteProvider(mockAIProvider);

      editor.handleInput("/");
      editor.handleInput("a");
      editor.handleInput("i");

      await Bun.sleep(100); // Simulate debounce

      expect(editor.isShowingAutocomplete()).toBe(true);
    });

    it("applies AI suggestion on Tab press", async () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setAutocompleteProvider(mockAIProvider);

      editor.handleInput("/");
      editor.handleInput("a");
      editor.handleInput("i");

      await Bun.sleep(100);

      editor.handleInput("\t"); // Tab to apply suggestion

      await Bun.sleep(0);

      expect(editor.getText()).toBe("/ai-suggest");
      expect(editor.isShowingAutocomplete()).toBe(false);
    });

    it("handles AI suggestion errors gracefully", async () => {
      const errorProvider = {
        async getSuggestions() {
          throw new Error("AI service unavailable");
        },
      };
      const editor = new Editor(defaultEditorTheme);
      editor.setAutocompleteProvider(errorProvider);

      editor.handleInput("/");
      editor.handleInput("a");
      editor.handleInput("i");

      await Bun.sleep(100);

      // Should not crash, autocomplete should be hidden
      expect(editor.isShowingAutocomplete()).toBe(false);
    });
  });

  describe("Markdown Editing", () => {
    it("renders markdown headings correctly", () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setText("# Heading 1\n## Heading 2");

      const rendered = editor.render();
      expect(stripVTControlCharacters(rendered)).toContain("Heading 1");
      expect(stripVTControlCharacters(rendered)).toContain("Heading 2");
    });

    it("supports markdown lists", () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setText("- Item 1\n- Item 2");

      const rendered = editor.render();
      expect(stripVTControlCharacters(rendered)).toContain("Item 1");
      expect(stripVTControlCharacters(rendered)).toContain("Item 2");
    });

    it("handles markdown code blocks", () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setText("```javascript\nconsole.log('test');\n```");

      const rendered = editor.render();
      expect(stripVTControlCharacters(rendered)).toContain("console.log('test')");
    });
  });

  describe("Performance", () => {
    it("handles large files without crashing", () => {
      const editor = new Editor(defaultEditorTheme);
      const largeText = "# Header\n".repeat(10000);

      editor.setText(largeText);
      const rendered = editor.render();

      expect(rendered).toBeDefined();
    });

    it("measures rendering time for performance benchmarking", () => {
      const editor = new Editor(defaultEditorTheme);
      const text = "# Header\nContent".repeat(100);

      const start = performance.now();
      editor.setText(text);
      editor.render();
      const end = performance.now();

      const renderTime = end - start;
      expect(renderTime).toBeLessThan(100); // Should render in under 100ms
    });
  });

  describe("File Explorer Integration", () => {
    it("opens file from explorer", () => {
      const editor = new Editor(defaultEditorTheme);
      const fileContent = "# Test File\nContent";

      editor.openFile("test.md", fileContent);

      expect(editor.getText()).toBe(fileContent);
    });

    it("saves file to explorer", () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setText("# Saved Content");

      const savedContent = editor.saveFile();

      expect(savedContent).toBe("# Saved Content");
    });

    it("handles file save errors", () => {
      const editor = new Editor(defaultEditorTheme);
      editor.setText("# Content");

      // Simulate save error
      const saveResult = editor.saveFile("invalid/path.md");

      expect(saveResult).toBeUndefined(); // Should return undefined on error
    });
  });
});