# RecruitmentTracker

Aplicativo React Native CLI para Android e iOS. A arquitetura proposta para a plataforma completa (web, mobile e API), as decisões de autenticação e as fases de implementação estão em [docs/architecture.md](docs/architecture.md).

O modelo alvo de dados PostgreSQL está em `prisma/schema.prisma`. As migrations executáveis estão em `apps/api/migrations`. O administrador inicial é configurado por `INITIAL_ADMIN_EMAIL`; use `apps/api/.env.example` como base da configuração local.

## API inicial

A API Node.js + PostgreSQL em [apps/api](apps/api/README.md) fornece login Google, usuários/papéis, vagas, etapas, candidatos, candidaturas, movimentações, aprovações, encerramentos, atividades e métricas de resumo. A API e o banco local já foram iniciados e migrados nesta máquina.

## Aplicativo web

O painel React está em `apps/web` e usa a mesma API e banco. Inclui dashboard, vagas, pipeline Kanban, movimentação, notas/timeline, fila de aprovações, configuração de etapas e painel de usuários para o administrador. Copie `apps/web/.env.example` para `apps/web/.env.local`, defina `VITE_GOOGLE_CLIENT_ID` e inicie com `npm run web`. Para login funcionar, configure o mesmo client ID em `GOOGLE_CLIENT_IDS` na API e em `WEB_ORIGIN` com `http://localhost:5173`.

## Inicialização local

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run db:up
npm run db:migrate
npm run api
npm run web
```

Preencha os IDs OAuth e o `INITIAL_ADMIN_EMAIL` em `apps/api/.env` e `VITE_GOOGLE_CLIENT_ID` em `apps/web/.env.local` antes do login. O app mobile usa o mesmo backend. O e-mail de bootstrap não foi informado, então a conta de administrador ainda precisa ser escolhida na configuração local.

## Login Google no mobile

Defina `GOOGLE_WEB_CLIENT_ID` e `GOOGLE_IOS_CLIENT_ID` em `src/config.ts`. Cadastre os clientes OAuth Android (package `com.recruitmenttracker` e SHA-1 do certificado debug/release) e iOS no Google Cloud. No iOS, adicione o URL scheme reverso do cliente iOS em `ios/RecruitmentTracker/Info.plist` e rode `bundle exec pod install`. A API deve aceitar os client IDs web/iOS usados para emitir os tokens em `GOOGLE_CLIENT_IDS`. Use `API_BASE_URL` com o endereço LAN do computador em dispositivos físicos; o valor padrão cobre simuladores/emuladores locais.

## Aplicativo mobile

Este projeto usa [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
