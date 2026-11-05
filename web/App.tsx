import { Route, Routes } from 'react-router-dom'
import { I18nProvider } from './lib/i18n'
import { Landing } from './pages/Landing'
import { Setup } from './pages/Setup'
import { Hub } from './pages/Hub'
import { Report } from './pages/Report'
import { History } from './pages/History'
import { Shared } from './pages/Shared'
import { NotFound } from './pages/NotFound'
import { Admin } from './pages/Admin'

export function AppRoutes() {
  return (
    <I18nProvider>
      <div className="app">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/history" element={<History />} />
          <Route path="/c/:chatId" element={<Hub />} />
          <Route path="/c/:chatId/reports/:reportId" element={<Report />} />
          <Route path="/s/:shareId" element={<Shared />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </I18nProvider>
  )
}
