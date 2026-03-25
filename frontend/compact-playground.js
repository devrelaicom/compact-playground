/**
 * Compact Playground - Interactive code blocks for mdBook
 *
 * This script adds "Run" buttons to Compact code blocks and displays
 * compilation results inline below the code.
 *
 * Usage:
 * 1. Add this script to your mdBook's additional-js
 * 2. Configure the API URL below or via data attribute
 * 3. Code blocks with language "compact" will get run buttons
 */

(function () {
  "use strict";

  // Configuration - Update this to your deployed API URL
  const DEFAULT_API_URL =
    window.COMPACT_PLAYGROUND_API_URL ||
    document.currentScript?.dataset?.apiUrl ||
    "https://compact-playground.onrender.com";

  // Icons as SVG strings
  const ICONS = {
    play: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    loading:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>',
    success:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };

  class CompactPlayground {
    constructor(options = {}) {
      this.apiUrl = options.apiUrl || DEFAULT_API_URL;
      this.selector = options.selector || "code.language-compact";
      this.editable = options.editable !== false;
      this.autoRun = options.autoRun || false;
      this.codeBlocks = new Map();
    }

    /**
     * Initialize the playground - find and enhance all Compact code blocks
     */
    init() {
      const codeElements = document.querySelectorAll(this.selector);

      if (codeElements.length === 0) {
        console.log(
          "CompactPlayground: No Compact code blocks found on this page"
        );
        return;
      }

      console.log(
        `CompactPlayground: Found ${codeElements.length} Compact code block(s)`
      );

      codeElements.forEach((codeEl, index) => {
        this.enhanceCodeBlock(codeEl, index);
      });
    }

    /**
     * Enhance a code block with run button and output container
     */
    enhanceCodeBlock(codeEl, index) {
      // Find the parent pre element
      const preEl = codeEl.closest("pre");
      if (!preEl) return;

      // Skip if already enhanced
      if (preEl.classList.contains("compact-playground-enhanced")) return;
      preEl.classList.add("compact-playground-enhanced");

      // Create a wrapper for the entire playground
      const wrapper = document.createElement("div");
      wrapper.className = "compact-playground-wrapper";

      // Create toolbar
      const toolbar = document.createElement("div");
      toolbar.className = "compact-playground-toolbar";

      // Run button
      const runButton = document.createElement("button");
      runButton.className = "compact-playground-btn compact-playground-run";
      runButton.innerHTML = `${ICONS.play} <span>Run</span>`;
      runButton.title = "Compile and run (Ctrl+Enter)";
      runButton.setAttribute("aria-label", "Run code");
      toolbar.appendChild(runButton);

      // Copy button
      const copyButton = document.createElement("button");
      copyButton.className = "compact-playground-btn compact-playground-copy";
      copyButton.innerHTML = `${ICONS.copy} <span>Copy</span>`;
      copyButton.title = "Copy code to clipboard";
      copyButton.setAttribute("aria-label", "Copy code");
      toolbar.appendChild(copyButton);

      // Create output container
      const outputContainer = document.createElement("div");
      outputContainer.className = "compact-output";
      outputContainer.style.display = "none";

      // Wrap the pre element
      preEl.parentNode.insertBefore(wrapper, preEl);
      wrapper.appendChild(toolbar);
      wrapper.appendChild(preEl);
      wrapper.appendChild(outputContainer);

      // Make code editable if enabled
      if (this.editable) {
        codeEl.setAttribute("contenteditable", "true");
        codeEl.setAttribute("spellcheck", "false");
        codeEl.classList.add("compact-editable");

        // Handle Tab key for indentation
        codeEl.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();

            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;

            const range = selection.getRangeAt(0);
            range.deleteContents();

            const indentNode = document.createTextNode("  ");
            range.insertNode(indentNode);

            range.setStartAfter(indentNode);
            range.collapse(true);

            // Merge adjacent text nodes to prevent DOM fragmentation
            codeEl.normalize();

            selection.removeAllRanges();
            selection.addRange(range);
          }
          // Ctrl+Enter to run
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.runCode(codeEl, outputContainer, runButton);
          }
        });
      }

      // Store reference
      this.codeBlocks.set(index, {
        codeEl,
        outputContainer,
        runButton,
      });

      // Event listeners
      runButton.addEventListener("click", () => {
        this.runCode(codeEl, outputContainer, runButton);
      });

      copyButton.addEventListener("click", () => {
        this.copyCode(codeEl, copyButton);
      });

      // Auto-run if enabled
      if (this.autoRun) {
        this.runCode(codeEl, outputContainer, runButton);
      }
    }

    /**
     * Get the code from a code element
     */
    getCode(codeEl) {
      return codeEl.textContent || "";
    }

    /**
     * Run the code and display results
     */
    async runCode(codeEl, outputContainer, runButton) {
      const code = this.getCode(codeEl);

      if (!code.trim()) {
        this.showOutput(outputContainer, {
          success: false,
          error: "No code to compile",
        });
        return;
      }

      // Update UI to loading state
      runButton.disabled = true;
      runButton.innerHTML = `${ICONS.loading} <span>Compiling...</span>`;
      runButton.classList.add("loading");
      outputContainer.style.display = "block";
      outputContainer.className = "compact-output loading";
      outputContainer.innerHTML =
        '<div class="compact-output-message">Compiling...</div>';

      try {
        const result = await this.compile(code);
        this.showOutput(outputContainer, result);
      } catch (error) {
        this.showOutput(outputContainer, {
          success: false,
          error: "Network error",
          message: error.message || "Failed to connect to compilation server",
        });
      } finally {
        // Reset button state
        runButton.disabled = false;
        runButton.innerHTML = `${ICONS.play} <span>Run</span>`;
        runButton.classList.remove("loading");
      }
    }

    /**
     * Copy code to clipboard
     */
    async copyCode(codeEl, copyButton) {
      const code = this.getCode(codeEl);

      try {
        await navigator.clipboard.writeText(code);
        const originalHTML = copyButton.innerHTML;
        copyButton.innerHTML = `${ICONS.success} <span>Copied!</span>`;
        copyButton.classList.add("success");

        setTimeout(() => {
          copyButton.innerHTML = originalHTML;
          copyButton.classList.remove("success");
        }, 2000);
      } catch (err) {
        console.error("Failed to copy code:", err);
      }
    }

    /**
     * Compile code via API
     */
    async compile(code) {
      const response = await fetch(`${this.apiUrl}/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          options: {
            wrapWithDefaults: true,
            skipZk: true,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} - ${text}`);
      }

      const body = await response.json();
      return body.results[0];
    }

    /**
     * Display compilation results
     */
    showOutput(container, result) {
      container.style.display = "block";

      if (result.success) {
        container.className = "compact-output success";
        let html = `
          <div class="compact-output-header">
            ${ICONS.success}
            <span>Compilation Successful</span>
          </div>
        `;

        if (result.warnings && result.warnings.length > 0) {
          html += '<div class="compact-output-warnings">';
          html += "<strong>Warnings:</strong>";
          html += "<ul>";
          result.warnings.forEach((warning) => {
            html += `<li>${this.formatError(warning)}</li>`;
          });
          html += "</ul></div>";
        }

        if (result.executionTime) {
          html += `<div class="compact-output-meta">Compiled in ${result.executionTime}ms</div>`;
        }

        container.innerHTML = html;
      } else {
        container.className = "compact-output error";
        let html = `
          <div class="compact-output-header">
            ${ICONS.error}
            <span>Compilation Failed</span>
          </div>
        `;

        if (result.errors && result.errors.length > 0) {
          html += '<div class="compact-output-errors">';
          result.errors.forEach((error) => {
            html += `<div class="compact-error-item">${this.formatError(error)}</div>`;
          });
          html += "</div>";
        } else if (result.message) {
          html += `<div class="compact-output-message">${this.escapeHtml(result.message)}</div>`;
        } else if (result.error) {
          html += `<div class="compact-output-message">${this.escapeHtml(result.error)}</div>`;
        }

        container.innerHTML = html;
      }
    }

    /**
     * Format a single error for display
     */
    formatError(error) {
      let text = "";

      if (error.line) {
        text += `<span class="compact-error-location">Line ${error.line}`;
        if (error.column) {
          text += `:${error.column}`;
        }
        text += "</span> ";
      }

      text += `<span class="compact-error-message">${this.escapeHtml(error.message)}</span>`;

      return text;
    }

    /**
     * Escape HTML entities
     */
    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Auto-initialize on page load
  function initPlayground() {
    // Get configuration from script tag or global
    const scriptTag = document.currentScript || document.querySelector('script[src*="compact-playground"]');
    const config = {
      apiUrl: scriptTag?.dataset?.apiUrl || window.COMPACT_PLAYGROUND_API_URL || DEFAULT_API_URL,
      editable: scriptTag?.dataset?.editable !== "false",
      autoRun: scriptTag?.dataset?.autoRun === "true",
    };

    const playground = new CompactPlayground(config);
    playground.init();

    // Expose globally for programmatic access
    window.CompactPlayground = CompactPlayground;
    window.compactPlayground = playground;
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlayground);
  } else {
    // DOM already loaded (script loaded with defer or at end of body)
    initPlayground();
  }
})();
