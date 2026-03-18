import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BRAND, FONTS } from "@/lib/brand";

export interface CarrierScorecardResult {
  version: "carrier_scorecard_v1";
  overall: {
    total_score: number;
    max_score: number;
    percent: number;
    grade: "A" | "B" | "C" | "D" | "F";
    summary: string;
    confidence: number;
  };
  categories: Array<{
    id: string;
    label: string;
    max_score: number;
    status: "pass" | "minor_issues" | "major_issues" | "missing_info";
    score: number;
    finding: string;
    evidence: string[];
    recommendations: string[];
  }>;
  issues: Array<{
    severity: "low" | "medium" | "high";
    category_id?: string;
    title: string;
    description: string;
  }>;
  meta: {
    model: string;
    generated_at: string;
    request_id: string;
    validation_ok: boolean;
  };
}

function statusLabel(status: CarrierScorecardResult["categories"][number]["status"]): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "minor_issues":
      return "Minor Issues";
    case "major_issues":
      return "Major Issues";
    default:
      return "Missing Info";
  }
}

function statusColors(status: CarrierScorecardResult["categories"][number]["status"]): { text: string; bg: string } {
  if (status === "pass") return { text: "#166534", bg: "#dcfce7" };
  if (status === "minor_issues") return { text: "#92400e", bg: "#fef3c7" };
  if (status === "major_issues") return { text: "#991b1b", bg: "#fee2e2" };
  return { text: "#1f2937", bg: "#e5e7eb" };
}

export default function CarrierScorecardPanel({ audit }: { audit: CarrierScorecardResult }) {
  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
          Carrier Scorecard
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: BRAND.purpleSecondary }}>Total</p>
            <p className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>
              {audit.overall.total_score}/{audit.overall.max_score}
            </p>
          </div>
          <div className="p-3 rounded-lg" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: BRAND.purpleSecondary }}>Percent</p>
            <p className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>
              {audit.overall.percent}%
            </p>
          </div>
          <div className="p-3 rounded-lg" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: BRAND.purpleSecondary }}>Grade</p>
            <p className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>
              {audit.overall.grade}
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
          {audit.overall.summary}
        </p>

        <div className="space-y-3">
          {audit.categories.map((category) => {
            const colors = statusColors(category.status);
            return (
              <div key={category.id} className="rounded-lg p-3 border" style={{ borderColor: BRAND.greyLavender }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>
                    {category.label}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge className="shadow-none border-transparent text-xs" style={{ backgroundColor: colors.bg, color: colors.text }}>
                      {statusLabel(category.status)}
                    </Badge>
                    <span className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>
                      {category.score}/{category.max_score}
                    </span>
                  </div>
                </div>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: BRAND.purpleSecondary }}>
                  {category.finding}
                </p>
              </div>
            );
          })}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            Issues
          </h3>
          {audit.issues.length === 0 ? (
            <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>No issues reported.</p>
          ) : (
            <ul className="space-y-2">
              {audit.issues.map((issue, index) => (
                <li key={`${issue.title}-${index}`} className="text-xs rounded p-2" style={{ backgroundColor: BRAND.offWhite, color: BRAND.deepPurple }}>
                  <span style={{ fontWeight: 700 }}>{issue.severity.toUpperCase()}</span> - {issue.title}: {issue.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
