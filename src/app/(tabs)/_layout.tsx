import { Tabs } from 'expo-router';
import { Text, useColorScheme } from 'react-native';

export default function TabLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return (
    <Tabs
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => {
          const icons: Record<string, string> = {
            index: '🏠',
            gastos: '💸',
            metas: '🎯',
            historial: '📊',
            salario: '💰',
          };
          return (
            <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
              {icons[route.name] || '📌'}
            </Text>
          );
        },
        tabBarActiveTintColor: '#185FA5',
        tabBarInactiveTintColor: dark ? '#8E8E93' : '#6B6B6B',
        tabBarStyle: {
          backgroundColor: dark ? '#1C1C1E' : '#FFFFFF',
          borderTopColor: dark ? '#2C2C2E' : '#E5E5EA',
          borderTopWidth: 0.5,
          height: 80,
          paddingBottom: 16,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerStyle: {
          backgroundColor: dark ? '#1C1C1E' : '#FFFFFF',
          shadowColor: 'transparent',
          elevation: 0,
          borderBottomWidth: 0.5,
          borderBottomColor: dark ? '#2C2C2E' : '#E5E5EA',
        } as any,
        headerTintColor: dark ? '#FFFFFF' : '#1A1A1A',
        headerTitleStyle: { fontSize: 17, fontWeight: '700' },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Resumen' }} />
      <Tabs.Screen name="gastos" options={{ title: 'Nuevo gasto' }} />
      <Tabs.Screen name="metas" options={{ title: 'Metas de ahorro' }} />
      <Tabs.Screen name="historial" options={{ title: 'Historial' }} />
      <Tabs.Screen name="salario" options={{ title: 'Sueldo' }} />
    </Tabs>
  );
}