/**
 * Visual highlighting for editable elements
 */

export class Highlighter {
  private activeElement: HTMLElement | null = null;
  private outline: HTMLDivElement;

  constructor() {
    // Create the highlight outline element
    this.outline = document.createElement('div');
    this.outline.style.cssText = `
      position: absolute;
      pointer-events: none;
      border: 2px solid #3b82f6;
      border-radius: 4px;
      transition: all 0.2s ease;
      z-index: 9998;
      display: none;
    `;
    document.body.appendChild(this.outline);
  }

  /**
   * Highlight an element
   */
  highlight(element: HTMLElement): void {
    this.activeElement = element;
    const rect = element.getBoundingClientRect();
    
    this.outline.style.display = 'block';
    this.outline.style.top = `${rect.top + window.scrollY}px`;
    this.outline.style.left = `${rect.left + window.scrollX}px`;
    this.outline.style.width = `${rect.width}px`;
    this.outline.style.height = `${rect.height}px`;
  }

  /**
   * Remove highlight
   */
  unhighlight(): void {
    this.activeElement = null;
    this.outline.style.display = 'none';
  }

  /**
   * Update highlight position (useful during scroll)
   */
  updatePosition(): void {
    if (this.activeElement) {
      this.highlight(this.activeElement);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.outline.remove();
  }
}
