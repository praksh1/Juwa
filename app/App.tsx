import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '@juwa/ui';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { SlotsScreen } from './src/screens/SlotsScreen';
import { BlackjackScreen } from './src/screens/BlackjackScreen';
import { StoreScreen } from './src/screens/StoreScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AppGate } from './src/AppGate';
import { registerServiceWorker } from './src/pwa';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/**
 * The lobby is a stack so tapping a game pushes the game screen over it. The
 * tab bar stays visible underneath, which is what players expect from a casino
 * app — leaving a game is always one tap.
 */
function LobbyStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Games" component={LobbyScreen} />
      <Stack.Screen
        name="juwa-classic-slots"
        component={SlotsScreen}
        options={{ headerShown: true, title: 'Juwa Classic' }}
      />
      <Stack.Screen
        name="juwa-blackjack"
        component={BlackjackScreen}
        options={{ headerShown: true, title: 'Blackjack' }}
      />
    </Stack.Navigator>
  );
}

/**
 * Navigation theme, driven entirely by our design tokens so the chrome around
 * the screens matches the screens themselves.
 */
const theme: Theme = {
  dark: true,
  colors: {
    primary: colors.gold.default,
    background: colors.surface.base,
    card: colors.surface.raised,
    text: colors.text.primary,
    border: colors.surface.border,
    notification: colors.neon.magenta,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Lobby: 'game-controller',
  Store: 'cart',
  Wallet: 'wallet',
  Profile: 'person',
};

export default function App() {
  // Registers the offline shell. No-op off the web.
  React.useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        <AppGate>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.gold.default,
            tabBarInactiveTintColor: colors.text.muted,
            // Colours only. React Navigation already sizes the bar against the
            // device's bottom safe-area inset; overriding the height or padding
            // clips the labels on phones with a home indicator.
            tabBarStyle: {
              backgroundColor: colors.surface.raised,
              borderTopColor: colors.surface.border,
            },
            tabBarLabelStyle: { fontSize: typography.caption.fontSize },
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={ICONS[route.name] ?? 'ellipse'} size={size} color={color} />
            ),
          })}
        >
          <Tab.Screen name="Lobby" component={LobbyStack} />
          <Tab.Screen name="Store" component={StoreScreen} />
          <Tab.Screen name="Wallet" component={WalletScreen} />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
        </AppGate>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
