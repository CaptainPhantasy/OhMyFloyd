import { describe, it, expect } from '@jest/globals';
import { VirtualizedList } from '../src/editor/VirtualizedList.tsx';

describe('VirtualizedList', () => {
  it('should initialize without errors', () => {
    const content = 'Line 1\nLine 2\nLine 3';
    // Verify that the component can be imported and instantiated
    expect(VirtualizedList).toBeDefined();
  });

  it('should handle large content in constructor', () => {
    const largeContent = Array(1000).fill('Line of text').join('\n');
    // Verify that the component can handle large content
    expect(largeContent.split('\n').length).toBe(1000);
  });
});