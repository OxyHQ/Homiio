# Homiio Optimization Plan

Plan exhaustivo para mejorar rendimiento, eficiencia y limpieza del código en backend y frontend.

---

## Paquetes OXY Actualizados

| Paquete | Anterior | Nuevo | Ubicación |
|---------|----------|-------|-----------|
| `@oxyhq/core` | 1.0.2 | **1.4.0** | root, backend, frontend |
| `@oxyhq/services` | 6.0.1 | **6.1.5** | root, frontend |

---

## FASE 1: Backend — Problemas Críticos

### 1.1 Refactorizar `profileController.ts` (2411 líneas → ~5 archivos)

**Problema:** El archivo más grande del backend (78KB) mezcla lógica de perfiles, propiedades guardadas, búsquedas, trust score y visualizaciones recientes. Contiene 24+ `require()` inline dentro de métodos.

**Archivos afectados:**
- `packages/backend/controllers/profileController.ts`

**Acciones:**
- [ ] Separar en módulos: `profileController.ts`, `savedController.ts`, `savedSearchController.ts`, `trustScoreController.ts`, `recentlyViewedController.ts`
- [ ] Mover todos los `require()` inline a imports estáticos al inicio de cada archivo
- [ ] Extraer el patrón repetido de autenticación (`req.user?.id || req.user?._id` + check 401) a un middleware `requireAuth`
- [ ] Centralizar formato de error/success responses en `middlewares/responseHelpers.ts`

**Impacto:** Mantenibilidad, tiempos de carga de módulo, developer experience.

---

### 1.2 Eliminar N+1 Queries en Property Listing

**Problema:** `controllers/property/list.ts:278-292` usa `.find()` en un loop para buscar propiedades vistas recientemente → O(n²).

**Archivos afectados:**
- `packages/backend/controllers/property/list.ts`

**Acciones:**
- [ ] Reemplazar el loop `.find()` con un `Map` lookup (O(1) por búsqueda)
- [ ] Eliminar las múltiples pasadas de `.map()` sobre el array de propiedades (líneas 220-276) — reducir a una sola pasada
- [ ] Usar `$geoNear` de MongoDB en lugar del cálculo Haversine manual en memoria (líneas 243-252)

**Impacto:** 10-100x mejora en búsquedas geográficas y listados con datos de usuario.

---

### 1.3 Implementar Cache con Redis (reemplazar Map en memoria)

**Problema:** `profileController.ts:15-17` usa un `Map` en memoria sin evicción automática → memory leak en producción. No hay invalidación al guardar perfiles.

**Archivos afectados:**
- `packages/backend/controllers/profileController.ts:15-17, 111-136, 193-195`

**Acciones:**
- [ ] Reemplazar `profileCache = new Map()` con Redis (la config ya tiene `redis.url` en `config.ts`)
- [ ] Implementar invalidación de cache al crear/actualizar/borrar perfiles
- [ ] Añadir cache para queries frecuentes: propiedades por ciudad, búsquedas guardadas
- [ ] Configurar TTL automático en Redis (5 min para perfiles, 15 min para propiedades)

**Impacto:** Elimina memory leaks, mejora consistencia de datos, reduce queries a MongoDB.

---

### 1.4 Añadir Índices MongoDB Faltantes

**Problema:** Queries frecuentes sin índices compuestos causan full collection scans.

**Archivos afectados:**
- `packages/backend/models/schemas/PropertySchema.ts:466-479`
- `packages/backend/models/schemas/ProfileSchema.ts:608-614`

**Acciones:**
- [ ] Añadir índice `{ profileId: 1, createdAt: -1 }` en PropertySchema (usado en listados de usuario)
- [ ] Añadir índice `{ status: 1, "availability.isAvailable": 1 }` en PropertySchema (usado en búsquedas)
- [ ] Añadir índice `{ "address.coordinates": "2dsphere" }` si falta (necesario para `$geoNear`)
- [ ] Verificar y optimizar el índice parcial `{ oxyUserId: 1, isActive: 1 }` en ProfileSchema para evitar race conditions

**Impacto:** 10-100x mejora en queries de búsqueda y listado.

---

### 1.5 Corregir Trust Score Calculation

**Problema:** `ProfileSchema.ts:754-869` referencia campos inexistentes (`basicInfo`, `employment`), siempre retorna 0 para esos factores.

**Archivos afectados:**
- `packages/backend/models/schemas/ProfileSchema.ts:732-969`

**Acciones:**
- [ ] Corregir referencias: `personal.basicInfo` → `personal.personalInfo`, `personal.employment` → `personal.employmentStatus`
- [ ] Cachear resultado del trust score en el documento (no recalcular en cada request)
- [ ] Recalcular solo cuando cambien campos relevantes (usar middleware `pre-save`)

**Impacto:** Trust scores correctos, eliminación de cálculos CPU innecesarios.

---

## FASE 2: Backend — Rendimiento y Limpieza

### 2.1 Eliminar Logging Excesivo

**Problema:** 25+ `console.log` en rutas críticas (CORS, auth, DB). Bloquean el event loop de forma síncrona. Algunos loguean datos sensibles (headers de autorización, user IDs).

**Archivos afectados:**
- `packages/backend/server.ts:38-76, 169`
- `packages/backend/database/connection.ts:25-86`
- `packages/backend/controllers/profileController.ts:263-289`

**Acciones:**
- [ ] Reemplazar todos los `console.log` con un logger estructurado (Pino — más rápido que Winston, ideal para serverless)
- [ ] Configurar niveles: `error` en producción, `debug` en desarrollo
- [ ] Eliminar logs de CORS (5-7 por request) — dejar solo log de rechazo
- [ ] Eliminar logging de headers de autorización (riesgo de seguridad)

**Impacto:** 5-10% mejora en throughput, eliminación de riesgo de seguridad.

---

### 2.2 Optimizar Middleware Chain

**Problema:** CORS ejecuta regex repetido en cada request. Body parser tiene lógica custom innecesariamente compleja.

**Archivos afectados:**
- `packages/backend/server.ts:38-76, 142-159`

**Acciones:**
- [ ] Pre-compilar whitelist de CORS como Set para O(1) lookup en orígenes exactos
- [ ] Simplificar detección de LAN/Vercel preview con una sola regex combinada
- [ ] Simplificar body parser: usar `express.json()` con `verify` callback para raw body (Stripe) en lugar de middleware custom

**Impacto:** Menos CPU por request, código más limpio.

---

### 2.3 Limpiar Dependencias Innecesarias del Backend

**Problema:** Dependencias duplicadas o posiblemente innecesarias.

**Archivos afectados:**
- `packages/backend/package.json`

**Acciones:**
- [ ] Evaluar `telegraf` vs `node-telegram-bot-api` — ambos hacen lo mismo, elegir uno
- [ ] Evaluar si `bcryptjs` y `jsonwebtoken` siguen siendo necesarios con `@oxyhq/core` 1.4.0 manejando auth
- [ ] Evaluar si `jwt-decode` es necesario (solo decodifica sin verificar)
- [ ] Mover `node-fetch` de devDependencies a dependencies si se usa en runtime, o eliminar si no

**Impacto:** Bundle más pequeño, menos vulnerabilidades, menos mantenimiento.

---

### 2.4 Mejorar Validación de Input

**Problema:** Parámetros de paginación sin validar (`page`, `limit` pueden ser NaN, negativos, o Infinity). Fechas sin validación de rango.

**Archivos afectados:**
- `packages/backend/controllers/property/list.ts:55-56, 169-175`

**Acciones:**
- [ ] Añadir middleware de validación de paginación: `page >= 1`, `limit >= 1 && limit <= 100`
- [ ] Validar rangos de fechas (no antes de 2020, no después de 2030)
- [ ] Usar `express-validator` de forma consistente en todas las rutas (ya es dependencia)

**Impacto:** Previene queries costosas, mejora robustez.

---

### 2.5 Gestión de Conexión y Procesos

**Problema:** `process.on('SIGINT')` registrado múltiples veces. Cron jobs sin cleanup graceful.

**Archivos afectados:**
- `packages/backend/database/connection.ts:91-94`
- `packages/backend/services/cron.ts:339-347`

**Acciones:**
- [ ] Registrar handler de SIGINT una sola vez (flag `listenerRegistered`)
- [ ] Implementar graceful shutdown: parar crons → cerrar conexiones HTTP → cerrar DB
- [ ] Añadir `process.on('SIGTERM')` para Vercel/container shutdown

**Impacto:** Evita memory leaks, shutdown limpio en producción.

---

### 2.6 Eliminar PostQuery Hook Global

**Problema:** `PropertySchema.ts:509-518` transforma campos de dirección en CADA query (find, findOne, findOneAndUpdate), incluso cuando no se necesita.

**Archivos afectados:**
- `packages/backend/models/schemas/PropertySchema.ts:509-518`

**Acciones:**
- [ ] Mover la transformación a un método estático explícito `.findWithAddress()`
- [ ] O usar `.lean({ transform: true })` solo donde se necesite
- [ ] Eliminar el hook global que corre en todas las queries

**Impacto:** Reducción de overhead en queries de solo lectura.

---

## FASE 3: Frontend — Problemas Críticos

### 3.1 Consolidar State Management (Context + Zustand → solo Zustand)

**Problema:** Existe duplicación entre 8 React Context providers y 23 Zustand stores. `ProfileContext.tsx` duplica `profileStore.ts`. `SavedPropertiesContext.tsx` duplica `savedPropertiesStore.ts`.

**Archivos afectados:**
- `packages/frontend/context/ProfileContext.tsx`
- `packages/frontend/context/SavedPropertiesContext.tsx`
- `packages/frontend/context/SavedPropertiesProvider.tsx`
- `packages/frontend/store/store.ts` (monolítico con 14 estados)
- `packages/frontend/store/profileStore.ts`
- `packages/frontend/store/propertyStore.ts`
- `packages/frontend/hooks/useProfile.ts`

**Acciones:**
- [ ] Migrar `ProfileContext` → `profileStore` de Zustand (eliminar provider, usar hook directo)
- [ ] Migrar `SavedPropertiesContext/Provider` → `savedPropertiesStore` de Zustand
- [ ] Descomponer `store/store.ts` monolítico (14 estados) en stores especializados existentes
- [ ] Eliminar `MapStateContext`, `SearchModeContext`, `LayoutScrollContext` → mover a Zustand stores dedicados
- [ ] Mantener solo `BottomSheetContext` como Context (necesita acceso a refs imperativas)
- [ ] Resultado: de 10+ providers a ~4 (OxyProvider, QueryClient, BottomSheet, PostHog)

**Impacto:** Elimina re-renders en cascada, simplifica árbol de componentes, una fuente de verdad.

---

### 3.2 Reducir Provider Nesting (app/_layout.tsx)

**Problema:** 13+ providers anidados. Cada update en un provider causa re-render en todos los hijos.

**Archivos afectados:**
- `packages/frontend/app/_layout.tsx:208-266`

**Acciones:**
- [ ] Tras la consolidación de state (3.1), reducir a ~4-5 providers
- [ ] Crear un componente `AppProviders` que componga los providers restantes de forma plana
- [ ] Lazy-load `PostHogProvider` solo en producción
- [ ] Mover `NotificationProvider` fuera del árbol de render (usar service worker pattern)

**Impacto:** Menos re-renders, startup más rápido, código más limpio.

---

### 3.3 Optimizar Carga de Fuentes

**Problema:** 18 archivos de fuentes cargados síncronamente antes del primer render (6 Roboto + 7 Inter + 5 Phudu).

**Archivos afectados:**
- `packages/frontend/app/_layout.tsx:120-142`

**Acciones:**
- [ ] Reducir a fuentes esenciales: Roboto Regular + Medium + Bold (3 en vez de 6)
- [ ] Lazy-load Inter y Phudu solo cuando se usen (en rutas específicas)
- [ ] Usar `expo-font` con fallback a fuentes del sistema durante carga
- [ ] Considerar usar solo Inter como fuente principal (ya es fuente del sistema en iOS 17+/Android 14+)

**Impacto:** Reducción de 50-70% en tiempo de carga inicial de fuentes.

---

### 3.4 Eliminar Waterfall de Requests en Home (app/index.tsx)

**Problema:** La página principal hace requests en cascada: Location → Cities → Distance calc → Properties per city → Tips. Total: 3-4 roundtrips secuenciales.

**Archivos afectados:**
- `packages/frontend/app/index.tsx:63-183`

**Acciones:**
- [ ] Usar React Query `useQuery` para cities y tips en paralelo (no `useEffect` + `setState`)
- [ ] Precargar cities y tips en `_layout.tsx` con `queryClient.prefetchQuery()`
- [ ] Batch requests de propiedades por ciudad: un solo endpoint `/api/properties/by-cities` que acepte array de city IDs
- [ ] Memoizar cálculo de distancias con `useMemo` basado en `[userLocation, cities]`
- [ ] Resultado esperado: de 4 roundtrips secuenciales a 1-2 paralelos

**Impacto:** 60-70% reducción en tiempo de carga del home.

---

### 3.5 Corregir Patrones de Data Fetching

**Problema:** `usePropertyQueries.ts` usa `fetchQuery` (imperativo) en vez de `useQuery` (declarativo), perdiendo caching automático. Los services retornan datos vacíos en error (silencian fallos).

**Archivos afectados:**
- `packages/frontend/hooks/usePropertyQueries.ts:14-34`
- `packages/frontend/services/propertyService.ts:24-37, 50-66, 88-92`
- `packages/frontend/services/profileService.ts:53-77`

**Acciones:**
- [ ] Convertir `fetchQuery` a `useQuery` en `usePropertyQueries` para caching declarativo
- [ ] Configurar React Query globalmente: `staleTime: 5min`, `gcTime: 30min`, `retry: 2`
- [ ] En services: lanzar errores (`throw`) en vez de retornar datos vacíos — dejar que React Query maneje reintentos
- [ ] Añadir `queryKey` factories: `propertyKeys.list(filters)`, `propertyKeys.detail(id)`, etc.
- [ ] Implementar optimistic updates para operaciones de guardado

**Impacto:** Cache automático, reintentos, menos requests duplicados, UI de error funcional.

---

### 3.6 Añadir Error Boundaries por Sección

**Problema:** Sin error boundaries, un fallo en una sección (ej: mapa) crashea toda la app.

**Archivos afectados:**
- `packages/frontend/app/index.tsx`
- `packages/frontend/app/_layout.tsx`

**Acciones:**
- [ ] Crear componente `SectionErrorBoundary` con UI de retry
- [ ] Envolver cada sección del home: mapa, propiedades destacadas, tips, ciudades
- [ ] Envolver rutas principales en `_layout.tsx`
- [ ] Implementar `ErrorBoundary` con reporte a PostHog

**Impacto:** Resilience — fallos aislados, no cascada.

---

## FASE 4: Frontend — Rendimiento y Limpieza

### 4.1 Eliminar Código de Debug en Producción

**Problema:** `console.log` en services, IIFEs de debug en JSX, datos hardcodeados en componentes.

**Archivos afectados:**
- `packages/frontend/services/profileService.ts:55-61, 125-131, 165-172, 257-264`
- `packages/frontend/app/index.tsx:489-509` (IIFE debug en render)
- `packages/frontend/components/PropertyCard.tsx:197-198` (rating: 4.5 hardcodeado)

**Acciones:**
- [ ] Eliminar todos los `console.log` de services (o envolver en `__DEV__`)
- [ ] Eliminar IIFE de debug en `index.tsx:489-509`
- [ ] Reemplazar datos hardcodeados en `PropertyCard` con valores reales del API o `null`
- [ ] Configurar ESLint rule `no-console` con excepción para `console.error`

**Impacto:** Bundle más limpio, sin overhead de logging en producción.

---

### 4.2 Optimizar Re-renders en Componentes

**Problema:** StyleSheet creados dentro de componentes, referencias inestables, comparaciones con `JSON.stringify`.

**Archivos afectados:**
- `packages/frontend/app/index.tsx:271` (StyleSheet en componente)
- `packages/frontend/app/index.tsx:342` (new Animated.Value en render)
- `packages/frontend/context/SavedPropertiesContext.tsx:240-244` (JSON.stringify para deep equal)

**Acciones:**
- [ ] Mover `StyleSheet.create()` fuera de componentes (nivel de módulo)
- [ ] Crear `Animated.Value(0)` con `useRef` en vez de inline
- [ ] Reemplazar `JSON.stringify` comparison con comparación field-by-field o `lodash.isEqual`
- [ ] Añadir `React.memo()` a `PropertyCard`, `ReviewCard`, y otros componentes de lista

**Impacto:** Menos re-renders, mejor scrolling performance.

---

### 4.3 Limpiar Stores Zustand

**Problema:** `store/store.ts` es un store monolítico con 14 estados que ya existen en stores dedicados.

**Archivos afectados:**
- `packages/frontend/store/store.ts`
- Todos los stores en `packages/frontend/store/`

**Acciones:**
- [ ] Auditar qué estados de `store.ts` se usan realmente
- [ ] Migrar estados usados a sus stores dedicados
- [ ] Eliminar `store.ts` o reducirlo a re-exports
- [ ] Revisar que no haya 2 stores manejando el mismo dato

**Impacto:** Eliminación de estado duplicado, menos confusión.

---

### 4.4 Implementar Code Splitting por Ruta

**Problema:** Todas las dependencias se cargan al inicio. Features pesadas (mapa, cámara, AI chat) se cargan aunque no se usen.

**Archivos afectados:**
- `packages/frontend/app/` (todas las rutas)

**Acciones:**
- [ ] Usar `React.lazy()` para rutas pesadas: `/sindi` (AI chat), `/properties/[id]` (mapa), `/roommates`
- [ ] Lazy-load Mapbox solo cuando se navega a mapa
- [ ] Lazy-load `expo-camera` solo en rutas que la usen
- [ ] Configurar `expo-router` para chunk splitting automático en web

**Impacto:** 30-50% reducción en bundle size inicial.

---

### 4.5 Optimizar Imágenes

**Acciones:**
- [ ] Verificar que `expo-image` (ya instalado) se use en vez de `Image` de React Native en todas partes
- [ ] Configurar `cachePolicy: 'memory-disk'` en `expo-image` globalmente
- [ ] Usar `contentFit: 'cover'` con `placeholder` blur hash para loading states
- [ ] Servir imágenes en WebP desde S3/CDN con transformaciones de tamaño

**Impacto:** Menos memoria, carga visual más rápida.

---

## FASE 5: Shared Types y Monorepo

### 5.1 Mejorar Shared Types

**Archivos afectados:**
- `packages/shared-types/src/`

**Acciones:**
- [ ] Verificar que todos los tipos del backend están sincronizados con shared-types
- [ ] Añadir tipos para respuestas de API (`ApiResponse<T>`, `PaginatedResponse<T>`)
- [ ] Generar tipos automáticamente desde los schemas de Mongoose (evaluar `mongoose-tsgen`)
- [ ] Añadir validación runtime con los schemas AJV ya existentes

---

### 5.2 Scripts de Build y CI

**Acciones:**
- [ ] Añadir script `typecheck` al root que verifique los 3 packages
- [ ] Configurar `npm run lint` para que funcione (actualmente el backend falla)
- [ ] Añadir tests mínimos: al menos smoke tests para endpoints críticos
- [ ] Evaluar migrar de `ts-node` a `tsx` para el backend (más rápido, menos config)

---

## FASE 6: Seguridad

### 6.1 Fixes de Seguridad Prioritarios

**Acciones:**
- [ ] Stripe webhook: usar solo `rawBody` (no fallback a `body`/`bodyRaw`) en `billingController.ts:92-116`
- [ ] Eliminar logging de headers de autorización en `server.ts:169`
- [ ] Añadir rate limiting por IP a endpoints de escritura (el rate limit actual es global)
- [ ] Validar bounds en paginación para prevenir queries exhaustivas
- [ ] Ejecutar `npm audit fix` (45 vulnerabilidades detectadas)

---

## Orden de Ejecución Recomendado

### Sprint 1 — Quick Wins (mayor impacto, menor esfuerzo)
1. ~~Actualizar paquetes OXY~~ ✅
2. Añadir índices MongoDB faltantes (1.4)
3. Fix N+1 query en property listing (1.2)
4. Eliminar console.logs de producción (2.1, 4.1)
5. Fix trust score campos incorrectos (1.5)
6. `npm audit fix` (6.1)

### Sprint 2 — Data Layer
7. Implementar Redis cache (1.3)
8. Corregir data fetching patterns frontend (3.5)
9. Eliminar waterfall en home page (3.4)
10. Añadir error boundaries (3.6)

### Sprint 3 — Architecture
11. Refactorizar profileController.ts (1.1)
12. Consolidar state management (3.1, 3.2, 4.3)
13. Optimizar middleware chain (2.2)
14. Eliminar PostQuery hook global (2.6)

### Sprint 4 — Polish
15. Code splitting por ruta (4.4)
16. Optimizar fuentes (3.3)
17. Optimizar re-renders (4.2)
18. Optimizar imágenes (4.5)
19. Limpiar dependencias (2.3)
20. Mejorar shared types y CI (5.1, 5.2)
