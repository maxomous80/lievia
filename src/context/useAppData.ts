import { useContext } from 'react'
import { AppContext } from './contextStore'

export function useAppData() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useAppData deve essere usato dentro AppProvider')
  return value
}