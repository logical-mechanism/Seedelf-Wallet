import '@mantine/core/styles.css';
import type { AppProps } from "next/app";
import { MantineProvider } from '@mantine/core';


function Seedelf({ Component, pageProps }: AppProps) {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Component {...pageProps} />
    </MantineProvider>
  );
}

export default Seedelf;