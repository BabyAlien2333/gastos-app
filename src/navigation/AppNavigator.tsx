import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Text, useColorScheme } from 'react-native';
import DashboardScreen from '../../screens/DashboardScreen';
import ExpensesScreen from '../../screens/ExpensesScreen';
import GoalsScreen from '../../screens/GoalsScreen';
import HistoryScreen from '../../screens/HistoryScreen';

const Tab = createBottomTabNavigator();

const icons: Record<string, string> = {
  Inicio: '🏠',
  Gastos: '💸',
  Metas: '🎯',
  Historial: '📊',
};

export default function AppNavigator() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{icons[route.name]}</Text>
        ),
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
        },
        headerTintColor: dark ? '#FFFFFF' : '#1A1A1A',
        headerTitleStyle: { fontSize: 17, fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Inicio" component={DashboardScreen} options={{ title: 'Resumen' }} />
      <Tab.Screen name="Gastos" component={ExpensesScreen} options={{ title: 'Nuevo gasto' }} />
      <Tab.Screen name="Metas" component={GoalsScreen} options={{ title: 'Metas de ahorro' }} />
      <Tab.Screen name="Historial" component={HistoryScreen} options={{ title: 'Historial' }} />
    </Tab.Navigator>
  );
}
