import { Platform } from 'react-native';

// Configure the OAuth client IDs from Google Cloud before enabling login.
export const GOOGLE_WEB_CLIENT_ID = '';
export const GOOGLE_IOS_CLIENT_ID = '';

// Android emulator uses 10.0.2.2 to reach the host machine; replace with a LAN URL on devices.
export const API_BASE_URL = Platform.select({
  android: 'http://10.0.2.2:4000',
  default: 'http://localhost:4000',
}) as string;
