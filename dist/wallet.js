// Browser/mobile wallet glue (EIP-1193 + EIP-6963 discovery). Only does what the user clicks:
// connect, switch network, sign the sign-in message, send a prepared transaction.
// Account or network changes invalidate the session (onChange) so the user re-authenticates.
export class Wallet {
  constructor({ chainId, onChange }) {
    this.chainId = chainId;
    this.onChange = onChange;
    this.providers = [];
    window.addEventListener('eip6963:announceProvider', (e) => this.providers.push(e.detail));
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  pick() {
    const p = this.providers[0]?.provider ?? window.ethereum;
    if (!p) throw new Error('No wallet found. On mobile, open this page in your wallet app\'s browser.');
    return p;
  }

  async connect() {
    this.p = this.pick();
    const [address] = await this.p.request({ method: 'eth_requestAccounts' });
    if (!address) throw new Error('Wallet returned no account.');
    this.address = address;
    await this.ensureChain();
    if (!this.listening) {
      this.listening = true;
      this.p.on?.('accountsChanged', (a) => { if ((a[0] ?? '').toLowerCase() !== this.address?.toLowerCase()) { this.address = a[0]; this.onChange?.('account changed'); } });
      this.p.on?.('chainChanged', (c) => { if (Number(c) !== this.chainId) this.onChange?.('network changed'); });
    }
    return address;
  }

  async ensureChain() {
    const cur = Number(await this.p.request({ method: 'eth_chainId' }));
    if (cur === this.chainId) return;
    try {
      await this.p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + this.chainId.toString(16) }] });
    } catch {
      throw new Error(`Please switch your wallet to chain ${this.chainId}.`);
    }
  }

  async signMessage(message, address) {
    return this.p.request({ method: 'personal_sign', params: [message, address] });
  }

  /** Sends a prepared {to, data} transaction; waits for it to be mined. Returns the hash. */
  async send(tx) {
    if (!this.p) await this.connect();
    await this.ensureChain();
    const hash = await this.p.request({ method: 'eth_sendTransaction', params: [{ from: this.address, to: tx.to, data: tx.data, value: '0x0' }] });
    for (let i = 0; i < 120; i++) {
      const r = await this.p.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (r) { if (r.status !== '0x1') throw new Error('Transaction reverted: ' + hash); return hash; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    throw new Error('Transaction still pending: ' + hash + '. Check its status before retrying.');
  }
}
