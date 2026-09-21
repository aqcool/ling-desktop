import { mountLingApp } from './client.js'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('LING Renderer could not find its root element.')

mountLingApp(root)
