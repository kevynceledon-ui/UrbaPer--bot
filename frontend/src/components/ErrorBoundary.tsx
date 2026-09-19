import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { error: Error | null }

// Sin esto, un solo pedido con datos rotos (cliente/items faltante — ver
// OrderCard.tsx) tumbaba TODO el dashboard a pantalla blanca, no solo esa
// tarjeta, y como ese mismo pedido se vuelve a pedir al recargar, quedaba en
// loop hasta arreglar el dato a mano en la base de datos. Se usa en dos
// niveles: uno grande envolviendo toda la app (main.tsx, con `fallback`
// propio a pantalla completa) y uno chico por tarjeta (DashboardPage.tsx,
// con el fallback compacto por defecto de acá abajo) para que una sola
// tarjeta rota no tumbe el resto de la lista.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Error no capturado en el árbol de React:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="rounded-2xl border border-dashed border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">
            ⚠️ No se pudo mostrar este elemento (datos incompletos).
          </div>
        )
      )
    }
    return this.props.children
  }
}
