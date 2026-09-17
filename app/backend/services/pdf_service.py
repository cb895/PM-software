"""
services/pdf_service.py
PDF generation using WeasyPrint + Jinja2 HTML templates.
All documents share the same dark-on-white corporate style.
"""
import io
import logging
from datetime import datetime
from typing import Optional
from jinja2 import Environment, DictLoader

log = logging.getLogger(__name__)

# ============================================================
# Shared CSS for all PDFs
# ============================================================
PDF_CSS = """
@page {
    size: A4;
    margin: 20mm 18mm 24mm 18mm;
    @bottom-center {
        content: "MetabolicTrack Lab PM  ·  Page " counter(page) " of " counter(pages);
        font-size: 8pt;
        color: #888;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #1a1a1a;
    line-height: 1.5;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 12pt;
    border-bottom: 2pt solid #00a370;
    margin-bottom: 18pt;
}

.header-logo {
    display: flex;
    align-items: center;
    gap: 8pt;
}

.logo-mark {
    width: 28pt;
    height: 28pt;
    background: #00a370;
    color: white;
    font-size: 10pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4pt;
    letter-spacing: 0.05em;
}

.logo-text {
    font-size: 13pt;
    font-weight: 600;
    color: #1a1a1a;
}

.header-meta {
    text-align: right;
    font-size: 8pt;
    color: #555;
    line-height: 1.6;
}

.doc-title {
    font-size: 16pt;
    font-weight: 700;
    color: #00a370;
    margin-bottom: 4pt;
}

.doc-subtitle {
    font-size: 10pt;
    color: #555;
    margin-bottom: 18pt;
}

.section {
    margin-bottom: 16pt;
}

.section-title {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #444;
    margin-bottom: 8pt;
    padding-bottom: 3pt;
    border-bottom: 0.5pt solid #ddd;
}

.meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6pt 16pt;
    margin-bottom: 12pt;
}

.meta-item { display: flex; flex-direction: column; gap: 1pt; }

.meta-label {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    font-weight: 600;
}

.meta-value { font-size: 10pt; color: #1a1a1a; }

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    margin-bottom: 12pt;
}

thead th {
    background: #f4f4f4;
    padding: 5pt 8pt;
    text-align: left;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #555;
    border-bottom: 1pt solid #ddd;
}

tbody td {
    padding: 5pt 8pt;
    border-bottom: 0.5pt solid #eee;
    vertical-align: top;
}

tbody tr:last-child td { border-bottom: none; }

.badge {
    display: inline-block;
    padding: 1pt 5pt;
    border-radius: 3pt;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: capitalize;
}

.badge-green  { background: #e8f9f5; color: #00773f; }
.badge-amber  { background: #fef6e4; color: #92600a; }
.badge-red    { background: #fde8e6; color: #9e1a10; }
.badge-blue   { background: #e8f0fe; color: #1a56a0; }
.badge-gray   { background: #f0f0f0; color: #555; }

.note-block {
    background: #f9f9f9;
    border-left: 2pt solid #00a370;
    padding: 7pt 10pt;
    font-size: 9pt;
    color: #444;
    margin-bottom: 10pt;
    line-height: 1.6;
}

.total-row td {
    font-weight: 700;
    background: #f4f4f4;
    border-top: 1pt solid #ddd;
}

.footer-note {
    font-size: 7.5pt;
    color: #aaa;
    margin-top: 18pt;
    padding-top: 8pt;
    border-top: 0.5pt solid #eee;
    text-align: center;
}

.highlight { color: #00a370; font-weight: 600; }
.warn      { color: #c07a00; }
.danger    { color: #9e1a10; }
"""

# ============================================================
# HTML Templates
# ============================================================
TEMPLATES = {

# ---- Daily Log ----
"daily_log": """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{{ css }}</style></head><body>
<div class="header">
  <div class="header-logo">
    <div class="logo-mark">MT</div>
    <div class="logo-text">MetabolicTrack</div>
  </div>
  <div class="header-meta">
    Daily log<br>
    Generated {{ generated }}<br>
    MetabolicTrack Lab PM
  </div>
</div>

<div class="doc-title">Daily Log</div>
<div class="doc-subtitle">{{ employee }} · {{ log_date }}</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-label">Employee</span><span class="meta-value">{{ employee }}</span></div>
  <div class="meta-item"><span class="meta-label">Date</span><span class="meta-value">{{ log_date }}</span></div>
  <div class="meta-item"><span class="meta-label">Total hours</span><span class="meta-value highlight">{{ total_hours }}h</span></div>
  <div class="meta-item"><span class="meta-label">Projects</span><span class="meta-value">{{ projects_worked }}</span></div>
</div>

{% for entry in entries %}
<div class="section">
  <div class="section-title">{{ entry.project_code }} — {{ entry.project_name }} ({{ entry.hours_spent }}h)</div>

  {% if entry.work_completed %}
  <div class="meta-item" style="margin-bottom:8pt">
    <span class="meta-label">Work completed</span>
    <div class="note-block">{{ entry.work_completed }}</div>
  </div>
  {% endif %}

  {% if entry.issues_blockers %}
  <div class="meta-item" style="margin-bottom:8pt">
    <span class="meta-label">Issues / blockers</span>
    <div class="note-block" style="border-color:#f5a623">{{ entry.issues_blockers }}</div>
  </div>
  {% endif %}

  {% if entry.next_steps %}
  <div class="meta-item" style="margin-bottom:8pt">
    <span class="meta-label">Next steps</span>
    <div class="note-block" style="border-color:#4a9eff">{{ entry.next_steps }}</div>
  </div>
  {% endif %}

  {% if entry.tasks %}
  <table>
    <thead><tr><th>Task</th><th>Status update</th><th>Notes</th></tr></thead>
    <tbody>
    {% for t in entry.tasks %}
    <tr>
      <td>{{ t.task_title }}</td>
      <td>{% if t.status_update %}<span class="badge badge-{{ 'green' if t.status_update=='complete' else 'amber' }}">{{ t.status_update }}</span>{% else %}—{% endif %}</td>
      <td>{{ t.notes or '—' }}</td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if entry.consumables %}
  <table>
    <thead><tr><th>Consumable</th><th>Category</th><th>Quantity used</th><th>Notes</th></tr></thead>
    <tbody>
    {% for c in entry.consumables %}
    <tr>
      <td>{{ c.name }}</td>
      <td>{{ c.category }}</td>
      <td>{{ c.quantity_used }} {{ c.unit }}</td>
      <td>{{ c.notes or '—' }}</td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
  {% endif %}
</div>
{% endfor %}

<div class="footer-note">This document was auto-generated by MetabolicTrack Lab PM on {{ generated }}. Confidential — internal use only.</div>
</body></html>
""",

# ---- Purchase Order ----
"purchase_order": """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{{ css }}</style></head><body>
<div class="header">
  <div class="header-logo">
    <div class="logo-mark">MT</div>
    <div class="logo-text">MetabolicTrack</div>
  </div>
  <div class="header-meta">
    Purchase order<br>
    {{ po_number }}<br>
    {{ approved_date }}
  </div>
</div>

<div class="doc-title">{{ po_number }}</div>
<div class="doc-subtitle">Approved purchase order · {{ project_name }}</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-label">Supplier</span><span class="meta-value">{{ supplier }}</span></div>
  <div class="meta-item"><span class="meta-label">Project</span><span class="meta-value">{{ project_code }} — {{ project_name }}</span></div>
  <div class="meta-item"><span class="meta-label">Requested by</span><span class="meta-value">{{ requested_by }}</span></div>
  <div class="meta-item"><span class="meta-label">Approved by</span><span class="meta-value">{{ approved_by }}</span></div>
  <div class="meta-item"><span class="meta-label">Approval date</span><span class="meta-value">{{ approved_date }}</span></div>
  <div class="meta-item"><span class="meta-label">Priority</span><span class="meta-value">
    <span class="badge {{ 'badge-red' if priority in ['critical','high'] else 'badge-gray' }}">{{ priority }}</span>
  </span></div>
  {% if expected_delivery %}
  <div class="meta-item"><span class="meta-label">Expected delivery</span><span class="meta-value">{{ expected_delivery }}</span></div>
  {% endif %}
</div>

{% if notes %}
<div class="note-block">{{ notes }}</div>
{% endif %}

<div class="section">
  <div class="section-title">Line items</div>
  <table>
    <thead>
      <tr><th>Description</th><th>Product ID</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Total</th></tr>
    </thead>
    <tbody>
    {% for item in line_items %}
    <tr>
      <td>{{ item.description }}</td>
      <td>{{ item.product_id or '—' }}</td>
      <td>{{ item.quantity_ordered }}</td>
      <td>{{ item.unit }}</td>
      <td>${{ "%.2f"|format(item.unit_cost_estimate or 0) }}</td>
      <td>${{ "%.2f"|format((item.quantity_ordered or 0) * (item.unit_cost_estimate or 0)) }}</td>
    </tr>
    {% endfor %}
    <tr class="total-row">
      <td colspan="5">Estimated total</td>
      <td>${{ "%.2f"|format(estimated_total) }}</td>
    </tr>
    </tbody>
  </table>
</div>

<div class="footer-note">This document was auto-generated by MetabolicTrack Lab PM on {{ generated }}. Confidential — internal use only.</div>
</body></html>
""",

# ---- Leave Approval ----
"leave_approval": """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{{ css }}</style></head><body>
<div class="header">
  <div class="header-logo">
    <div class="logo-mark">MT</div>
    <div class="logo-text">MetabolicTrack</div>
  </div>
  <div class="header-meta">
    Leave approval<br>
    {{ approved_date }}<br>
    MetabolicTrack Lab PM
  </div>
</div>

<div class="doc-title">Leave Approval</div>
<div class="doc-subtitle">{{ employee }} · {{ leave_type|title }} leave</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-label">Employee</span><span class="meta-value">{{ employee }}</span></div>
  <div class="meta-item"><span class="meta-label">Leave type</span><span class="meta-value">
    <span class="badge badge-{{ 'red' if leave_type=='sick' else 'blue' if leave_type=='vacation' else 'gray' }}">{{ leave_type }}</span>
  </span></div>
  <div class="meta-item"><span class="meta-label">Start date</span><span class="meta-value">{{ start_date }}</span></div>
  <div class="meta-item"><span class="meta-label">End date</span><span class="meta-value">{{ end_date }}</span></div>
  <div class="meta-item"><span class="meta-label">Business days</span><span class="meta-value highlight">{{ days_requested }}</span></div>
  <div class="meta-item"><span class="meta-label">Approved by</span><span class="meta-value">{{ approved_by }}</span></div>
  <div class="meta-item"><span class="meta-label">Approval date</span><span class="meta-value">{{ approved_date }}</span></div>
  {% if leave_type == 'vacation' %}
  <div class="meta-item"><span class="meta-label">PTO remaining after leave</span>
    <span class="meta-value {% if pto_remaining < 3 %}warn{% endif %}">{{ pto_remaining }} days</span>
  </div>
  {% endif %}
</div>

{% if review_notes %}
<div class="note-block">{{ review_notes }}</div>
{% endif %}

{% if hr_meeting_required %}
<div class="note-block" style="border-color:#e8594a;background:#fde8e6">
  <strong>HR meeting required.</strong> This sick leave has exceeded 5 consecutive business days.
  An HR meeting must be scheduled to evaluate the return-to-work timeline or FMLA eligibility.
</div>
{% endif %}

<div class="footer-note">This document was auto-generated by MetabolicTrack Lab PM on {{ generated }}. Confidential — internal use only.</div>
</body></html>
""",

# ---- New Supplier ----
"new_supplier": """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{{ css }}</style></head><body>
<div class="header">
  <div class="header-logo">
    <div class="logo-mark">MT</div>
    <div class="logo-text">MetabolicTrack</div>
  </div>
  <div class="header-meta">
    New supplier record<br>
    {{ added_date }}<br>
    MetabolicTrack Lab PM
  </div>
</div>

<div class="doc-title">New Supplier Added</div>
<div class="doc-subtitle">{{ name }} · Added {{ added_date }}</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-label">Supplier name</span><span class="meta-value">{{ name }}</span></div>
  <div class="meta-item"><span class="meta-label">Code</span><span class="meta-value highlight">{{ code or '—' }}</span></div>
  <div class="meta-item"><span class="meta-label">Type</span><span class="meta-value">{{ supplier_type or '—' }}</span></div>
  <div class="meta-item"><span class="meta-label">Onboarding status</span><span class="meta-value">
    <span class="badge {{ 'badge-green' if onboarding_status=='Verified' else 'badge-amber' if onboarding_status=='Ready for Approval' else 'badge-gray' }}">{{ onboarding_status }}</span>
  </span></div>
  {% if contact_name %}
  <div class="meta-item"><span class="meta-label">Contact</span><span class="meta-value">{{ contact_name }}</span></div>
  {% endif %}
  {% if email %}
  <div class="meta-item"><span class="meta-label">Email</span><span class="meta-value">{{ email }}</span></div>
  {% endif %}
  {% if phone %}
  <div class="meta-item"><span class="meta-label">Phone</span><span class="meta-value">{{ phone }}</span></div>
  {% endif %}
  {% if website %}
  <div class="meta-item"><span class="meta-label">Website</span><span class="meta-value">{{ website }}</span></div>
  {% endif %}
  {% if categories %}
  <div class="meta-item"><span class="meta-label">Categories</span><span class="meta-value">{{ categories }}</span></div>
  {% endif %}
  <div class="meta-item"><span class="meta-label">Added by</span><span class="meta-value">{{ added_by }}</span></div>
</div>

{% if notes %}
<div class="note-block">{{ notes }}</div>
{% endif %}

<div class="footer-note">This document was auto-generated by MetabolicTrack Lab PM on {{ generated }}. Confidential — internal use only.</div>
</body></html>
""",

# ---- Weekly Report ----
"weekly_report": """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{{ css }}</style></head><body>
<div class="header">
  <div class="header-logo">
    <div class="logo-mark">MT</div>
    <div class="logo-text">MetabolicTrack</div>
  </div>
  <div class="header-meta">
    Weekly report<br>
    {{ week_start }} — {{ week_end }}<br>
    MetabolicTrack Lab PM
  </div>
</div>

<div class="doc-title">Weekly Report</div>
<div class="doc-subtitle">{{ week_start }} to {{ week_end }}</div>

{% if executive_summary %}
<div class="section">
  <div class="section-title">Executive summary</div>
  <div class="note-block">{{ executive_summary }}</div>
</div>
{% endif %}

{% for section in sections %}
<div class="section">
  <div class="section-title">{{ section.project_code }} — {{ section.project_name }}</div>

  <div class="meta-grid">
    <div class="meta-item"><span class="meta-label">Hours logged</span><span class="meta-value highlight">{{ section.total_hours }}h</span></div>
    <div class="meta-item"><span class="meta-label">Tasks completed</span><span class="meta-value">{{ section.tasks_completed }}</span></div>
    <div class="meta-item"><span class="meta-label">Budget spent this week</span><span class="meta-value">${{ "%.2f"|format(section.budget_spent_week or 0) }}</span></div>
    <div class="meta-item"><span class="meta-label">Total budget used</span><span class="meta-value {{ 'warn' if section.pct_spent > 80 else '' }}">${{ "%.0f"|format(section.budget_spent_total or 0) }} ({{ "%.0f"|format(section.pct_spent or 0) }}%)</span></div>
  </div>

  {% if section.ops_notes %}
  <div class="note-block">{{ section.ops_notes }}</div>
  {% endif %}

  {% if section.missing_logs %}
  <div class="note-block" style="border-color:#f5a623;background:#fef6e4">
    <strong>Missing logs:</strong> {{ section.missing_logs }}
  </div>
  {% endif %}
</div>
{% endfor %}

<div class="footer-note">This document was auto-generated by MetabolicTrack Lab PM on {{ generated }}. Confidential — internal use only.</div>
</body></html>
""",
}


# ============================================================
# PDF generation function
# ============================================================
def generate_pdf(template_name: str, context: dict) -> bytes:
    """Render a Jinja2 HTML template and convert to PDF bytes via WeasyPrint."""
    try:
        from weasyprint import HTML, CSS
    except ImportError:
        log.error("WeasyPrint not installed. Run: pip install weasyprint")
        raise

    env = Environment(loader=DictLoader(TEMPLATES))
    template = env.get_template(template_name)

    context["css"]       = PDF_CSS
    context["generated"] = datetime.now().strftime("%B %d, %Y at %I:%M %p")

    html_content = template.render(**context)
    pdf_bytes    = HTML(string=html_content).write_pdf()
    return pdf_bytes
