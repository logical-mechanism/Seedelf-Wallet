import "../styles/globals.css";
import "../styles/colors.css";
import type { AppProps } from "next/app";
import { MeshProvider } from "@meshsdk/react";
import Head from "next/head";

function Seedelf({ Component, pageProps }: AppProps) {
  return (
    <>
    <Head>
      <title>Seedelf</title>
      <meta property="og:title" content="Seedelf" key="og:title" />
      <meta name="description" content="A Cardano Stealth Wallet." />
      <meta property="og:description" content="A Cardano Stealth Wallet." key="og:description" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://www.seedelf.app/" />
      <meta property="og:image" content="/og-image.png" />
    </Head>
    <MeshProvider>
      <Component {...pageProps} />
    </MeshProvider>
    </>
  );
}

export default Seedelf;