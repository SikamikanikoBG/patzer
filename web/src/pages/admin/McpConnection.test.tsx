// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post } }));
import McpConnection from './McpConnection';

const savedStatus = {
  available: true,
  tunnelClientInstalled: true,
  localMcpCredentialsSaved: true,
  tunnelId: 'tunnel_6aee75738a388191881ae8e41540cdb9',
  runtimeKeySaved: true,
  configured: true,
  serviceInstalled: true,
  autoStart: true,
  serviceState: 'active',
  tunnelHealthy: true,
  connected: true,
  checkedAt: '2026-11-08T19:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(savedStatus);
  post.mockResolvedValue(savedStatus);
});
afterEach(cleanup);

describe('Admin → ChatGPT / MCP', () => {
  it('renders the saved tunnel without exposing the API key and shows live connectivity', async () => {
    render(<McpConnection />);
    expect(await screen.findByText('Tunnel connected')).toBeTruthy();
    const field = screen.getByPlaceholderText('tunnel_...') as HTMLInputElement;
    expect(field.value).toBe(savedStatus.tunnelId);
    expect(screen.getByText('Saved privately')).toBeTruthy();
    expect(screen.queryByText('sk-proj-secret-forbidden')).toBeNull();
  });

  it('can reconfigure using saved credentials, without prompting for the key', async () => {
    render(<McpConnection />);
    await screen.findByText('Tunnel connected');
    const submit = screen.getByText('Update & reconnect');
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/mcp/setup', {
      tunnelId: savedStatus.tunnelId,
      autoStart: true,
    }));
  });
});
