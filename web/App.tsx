import { Route, Routes } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { Setup } from './pages/Setup'
import { ReportPlaceholder } from './pages/ReportPlaceholder'
import { NotFound } from './pages/NotFound'

export function AppRoutes() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/c/:chatId/reports/:reportId" element={<ReportPlaceholder />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}
