import "@meshsdk/react/styles.css";
import '@mantine/core/styles.css';
import type { AppProps } from "next/app";
import { MantineProvider } from '@mantine/core';
import { MeshProvider } from "@meshsdk/react";

function Seedelf({ Component, pageProps }: AppProps) {
  return (
    <MantineProvider defaultColorScheme="dark">
      <MeshProvider>
        <Component {...pageProps} />
      </MeshProvider>
    </MantineProvider>
  );
}

export default Seedelf;