import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, withContext, generateRequestId, logStage, logError } from '../server/lib/logger';

describe('Structured Logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
  
  it('should generate unique request IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBe(8);
  });
  
  it('should log with timestamp and level', () => {
    logger.info('Test message');
    
    expect(consoleSpy).toHaveBeenCalled();
    const logOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);
    
    expect(parsed.level).toBe('INFO');
    expect(parsed.message).toBe('Test message');
    expect(parsed.timestamp).toBeDefined();
  });
  
  it('should include context when using withContext', async () => {
    await withContext({ requestId: 'test-req-123' }, () => {
      logger.info('Context test');
      return Promise.resolve();
    });
    
    expect(consoleSpy).toHaveBeenCalled();
    const logOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);
    
    expect(parsed.requestId).toBe('test-req-123');
  });
  
  it('should log errors with error details', () => {
    logError('Something failed', new Error('Test error'));
    
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);
    
    expect(parsed.level).toBe('ERROR');
    expect(parsed.error).toBe('Test error');
  });
  
  it('should log stage information', () => {
    logStage('IMPORT', 'Processing file');
    
    expect(consoleSpy).toHaveBeenCalled();
    const logOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);
    
    expect(parsed.stage).toBe('IMPORT');
    expect(parsed.message).toBe('Processing file');
  });
  
  it('should include additional data in logs', () => {
    logger.info('Test with data', { userId: '123', action: 'test' });
    
    const logOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);
    
    expect(parsed.data).toBeDefined();
    expect(parsed.data.userId).toBe('123');
    expect(parsed.data.action).toBe('test');
  });
});
