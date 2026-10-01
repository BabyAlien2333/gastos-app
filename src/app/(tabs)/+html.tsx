import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Este archivo personaliza el <html> base para la versión web de Expo Router.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es" translate="no">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* Evita que Chrome traduzca la página y rompa el DOM de React */}
        <meta name="google" content="notranslate" />

        {/* Recomendado por Expo para que los ScrollView se vean bien en web */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}