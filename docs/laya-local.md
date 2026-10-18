# Laya on this PC

Laya replaces the hosted Jev endpoint only for a Brain IA backend running on this same PC. The service is bound to `127.0.0.1`, so no LAN or public client can reach it.

1. Copy `.env.laya.example` to `.env.laya.local`.
2. Start Laya in one PowerShell window: `npm run laya:start`.
3. Start the backend in another: `npm run dev:laya`. This loads `.env.local` first, then the local Laya settings.

The service uses the multilingual checkpoint and runs in `shadow` mode. It records decisions but never changes classifications until calibration has passed. This PC currently has a CPU-only PyTorch build, so the default command uses CPU. Install a CUDA-capable PyTorch build and pass `-Device cuda` later to use the RTX GPU.

For the current Vercel deployment, a Cloudflare Quick Tunnel is running from this PC and the production `JEV_BASE_URL` points at its HTTPS URL. To recreate that bridge after a restart, start Laya first and then run `..\scripts\start-laya-tunnel.ps1`; update the Vercel `JEV_BASE_URL` if Cloudflare assigns a new URL. Quick Tunnel URLs are temporary and account-less, so use a named Cloudflare Tunnel or a persistent host before treating Laya as an always-on production dependency.
