import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Node Buffer shim required by bitcoinjs-lib / ecpair in the browser
if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;

createRoot(document.getElementById("root")!).render(<App />);
