import { BRAND, FONTS } from "@/lib/brand"
import { Upload as UploadIcon, Plus, Page, CloudUpload } from "iconoir-react"

export default function UploadPage() {
  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Upload / Ingest</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-3xl mx-auto">
          <div
            className="border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center transition-colors"
            style={{ borderColor: BRAND.purpleSecondary, backgroundColor: BRAND.white }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
              <CloudUpload width={32} height={32} style={{ color: BRAND.purple }} />
            </div>
            <p className="text-lg font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              Drag & drop claim documents here
            </p>
            <p className="text-sm mb-6" style={{ color: BRAND.purpleSecondary }}>
              or click below to browse files. Supports PDF, DOCX, and image files.
            </p>
            <button
              className="px-6 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center gap-2 cursor-not-allowed opacity-60"
              style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading }}
              disabled
            >
              <Plus width={16} height={16} />
              Browse Files
            </button>
            <p className="text-xs mt-4" style={{ color: BRAND.purpleSecondary }}>
              Coming soon — file upload and document ingestion is under development.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              icon={<UploadIcon width={20} height={20} />}
              title="Batch Upload"
              description="Upload multiple documents at once for a single claim."
            />
            <FeatureCard
              icon={<Page width={20} height={20} />}
              title="Auto-Extract"
              description="Automatically extract text and data from uploaded documents."
            />
            <FeatureCard
              icon={<CloudUpload width={20} height={20} />}
              title="Cloud Storage"
              description="Documents stored securely in Supabase cloud storage."
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
        <div style={{ color: BRAND.purple }}>{icon}</div>
      </div>
      <p className="text-sm font-semibold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{title}</p>
      <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>{description}</p>
    </div>
  )
}
