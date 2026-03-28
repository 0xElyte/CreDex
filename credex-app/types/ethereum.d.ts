/**
 * EIP-1193 Ethereum Provider type declaration.
 * Covers MetaMask, Coinbase Wallet, Rabby, WalletConnect injected provider, etc.
 */

interface EthereumProvider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  selectedAddress: string | null;
  chainId: string | null;
  isConnected: () => boolean;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export {};
