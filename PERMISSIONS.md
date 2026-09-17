# MetabolicTrack Lab PM — Permissions Reference

Last updated: September 3, 2026

## Roles

| Role | Email | Person |
|---|---|---|
| `ops_manager` | cb@metabolictrack.com | Chris Bagley |
| `ceo` | kj@metabolictrack.com | Kevin Jones |
| `qm_director` | kc@metabolictrack.com | Kaytlyn Crowe |
| `lab_tech` | ad@metabolictrack.com | Andrew Dimis |
| `lab_tech` | pw@metabolictrack.com | Patricia Walker |
| `lab_tech` | el@metabolictrack.com  | Emma Claire |

---

## Permissions Matrix

### Projects
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View all projects | ✅ | ✅ | ✅ | ✅ |
| Create project | — | — | — | ✅ |
| Edit project | — | — | — | ✅ |
| Add phases | — | — | — | ✅ |
| Deactivate project | — | — | — | ✅ |

### Dashboard
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View | ✅ | ✅ | ✅ | ✅ |
| Missing logs alert | — | — | ✅ | ✅ |

### Purchase Orders
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| Submit new request | ✅ | ✅ | ✅ | ✅ |
| View all POs | ✅ all | ✅ all | ✅ all | ✅ all |
| Approve / reject | — | ✅ | ✅ | ✅ |
| Update status | — | ✅ | ✅ | ✅ |

### Suppliers
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View supplier list & details | ✅ | ✅ | ✅ | ✅ |
| Add / edit supplier records | — | ✅ | — | ✅ |
| View portal credentials | — | ✅ | ✅ | ✅ |
| Edit portal credentials | — | — | — | ✅ |

### Consumables
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View inventory | ✅ | ✅ | ✅ | ✅ |
| Add new item | ✅ | ✅ | ✅ | ✅ |
| Edit item details | ✅ | ✅ | ✅ | ✅ |
| Adjust stock levels | ✅ | ✅ | ✅ | ✅ |
| View transaction history | ✅ | ✅ | ✅ | ✅ |

### Daily Logs
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| Submit own log | ✅ | ✅ | ✅ | ✅ |
| View all logs | ✅ | ✅ | ✅ | ✅ |
| See missing log alerts | — | — | — | ✅ |

### Tasks & Gantt Chart
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View tasks & Gantt | ✅ | ✅ | ✅ | ✅ |
| Create new tasks | — | — | ✅ | ✅ |
| Edit tasks / update status | — | — | ✅ | ✅ |
| Review delay proposals | — | — | ✅ | ✅ |

### Budget Tracker
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View budget & phases | — | — | ✅ | ✅ |
| Set / edit budget amounts | — | — | ✅ | ✅ |
| View budget entries | — | — | ✅ | ✅ |
| Add manual entry | — | — | ✅ | ✅ |

### KPI Tracking
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View KPI dashboard | — | — | ✅ | ✅ |
| Add KPI targets | — | — | ✅ | ✅ |
| Compute KPIs | — | — | ✅ | ✅ |
| Deactivate targets | — | — | ✅ | ✅ |

### Weekly Reports
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View published reports | ✅ | ✅ | ✅ | ✅ |
| Generate report draft | — | — | ✅ | ✅ |
| Write executive summary | — | — | ✅ | ✅ |
| Add per-project notes | — | — | ✅ | ✅ |
| Publish report | — | — | ✅ | ✅ |

---


### HR Portal
| Action | lab_tech | qm_director | ceo | ops_manager |
|---|---|---|---|---|
| View in/out board | ✅ | ✅ | ✅ | ✅ |
| Update own status | ✅ | ✅ | ✅ | ✅ |
| Update any user's status | — | — | — | ✅ |
| View team calendar | ✅ | ✅ | ✅ | ✅ |
| Create calendar events | ✅ | ✅ | ✅ | ✅ |
| Submit time off request | ✅ | ✅ | ✅ | ✅ |
| Approve / deny leave | — | — | — | ✅ |
| View own leave balance | ✅ | ✅ | ✅ | ✅ |
| View all leave balances | — | — | — | ✅ |
| Edit leave balances | — | — | — | ✅ |
| Patricia's schedule override | PW only | — | — | ✅ |

## Implementation Details

### Backend — `core/security.py`

```python
require_po_approver        = require_roles("ops_manager", "ceo", "qm_director")
require_supplier_editor    = require_roles("ops_manager", "qm_director")
require_credentials_access = require_roles("ops_manager", "ceo", "qm_director")
require_task_editor        = require_roles("ops_manager", "ceo")
require_budget_access      = require_roles("ops_manager", "ceo")
require_kpi_access         = require_roles("ops_manager", "ceo")
require_kpi_manager        = require_roles("ops_manager")
require_report_manager     = require_roles("ops_manager")
```

### Frontend — role checks use `hasRole()` from `AuthContext`

```js
// Examples
hasRole('ops_manager', 'ceo', 'qm_director')  // PO approve button
hasRole('ops_manager', 'qm_director')          // Supplier edit button
hasRole('ops_manager', 'ceo')                  // Task create/edit, Budget, KPI
hasRole('ops_manager')                         // Report generate/publish, KPI manage
```

### Sidebar nav visibility (AppLayout.js)
- Budget and KPI tabs only visible to `ops_manager` and `ceo`
- All other tabs visible to all roles

### Lab tech PO visibility
Lab techs only see their own POs in the list view. This is enforced server-side:
```sql
WHERE po.requested_by = :user_id  -- added when role = 'lab_tech'
```

---

## Adding a New Role

1. Add the value to the `user_role` enum in PostgreSQL
2. Add the role to relevant `require_roles()` calls in `core/security.py`
3. Update `NAV_ITEMS` in `AppLayout.js` if the role needs different nav visibility
4. Update `hasRole()` checks in relevant page components
5. Update this document
