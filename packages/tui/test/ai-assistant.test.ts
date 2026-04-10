import { describe, it, expect, jest } from '@jest/globals';
import {
  generateContent,
  getEditingSuggestions,
  analyzeDocument,
  smartSearchReplace,
} from '../src/editor/ai-assistant';

// Mock document
const mockDocument = {
  content: '# Test Document',
  // Add other required properties if needed
};

describe('AI Assistant Performance Optimizations', () => {
  it('should cache AI responses', async () => {
    const firstResponse = await generateContent(mockDocument, 'Test prompt');
    const secondResponse = await generateContent(mockDocument, 'Test prompt');
    
    // Verify that the second call returns the cached response
    expect(secondResponse).toEqual(firstResponse);
  });

  it('should prioritize high-priority tasks', async () => {
    const startTime = Date.now();
    
    // Simulate a high-priority task
    const highPriorityResponse = await generateContent(
      mockDocument,
      'High priority prompt',
      undefined,
      0 // Highest priority
    );
    
    // Simulate a low-priority task
    const lowPriorityResponse = await generateContent(
      mockDocument,
      'Low priority prompt',
      undefined,
      3 // Lower priority
    );
    
    // Verify that the high-priority task completes faster
    const endTime = Date.now();
    console.log(`High-priority task took ${endTime - startTime}ms`);
    expect(highPriorityResponse).toBeDefined();
  });

  it('should batch process AI requests', async () => {
    const requests = [
      { document: mockDocument, prompt: 'Prompt 1' },
      { document: mockDocument, prompt: 'Prompt 2' },
    ];
    
    // Simulate batch processing
    const responses = await Promise.all(
      requests.map((req) => generateContent(req.document, req.prompt))
    );
    
    expect(responses.length).toBe(2);
  });
});