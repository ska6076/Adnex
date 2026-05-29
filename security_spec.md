# Firestore Security Specification: Developer Resource Hub

This document defines the data invariants, threat vectors, and validation blueprints for the Cloud Firestore database.

## 1. Data Invariants
1. **Authenticated Access only for Writes**: No user can save, update, or delete a resource unless they are authenticated with a verified email account (`request.auth.token.email_verified == true`).
2. **Resource Ownership Invariant**: The `userId` of a resource must match the logged-in user (`request.auth.uid`). Users can only read and write their own resources (Split Collection/User containment model).
3. **No Update gaps**: No user can modify the `userId`, `url`, `id`, or `date` fields of a resource after creation.
4. **Size and Integrity constraints**:
   - `name`: string, between 1 and 200 characters.
   - `url`: string, starting with `http://` or `https://`, length <= 1000 characters.
   - `desc`: string, length <= 500 characters.
   - `category`: string, exactly match one of the predefined uppercase categories.
   - `tags`: list of strings, array size <= 10, each tag length <= 50.
   - `notes`: string, length <= 4000 characters.
   - `favorite`: boolean.

---

## 2. The "Dirty Dozen" Malicious Payloads

The following payloads attempt to break security rules. Our ruleset guarantees all these operations return `PERMISSION_DENIED`:

| ID | Terror Vector / Name | Attempted Payload Action | Target / Path | Expected Outcome |
|----|-----------------------|---------------------------|---------------|------------------|
| D1 | Identity Spoofing     | Create resource with `userId` of a different user. | `resources/res_123` | `PERMISSION_DENIED` |
| D2 | Resource Poisoning    | Inject 500 characters inside `name` field. | `resources/res_234` | `PERMISSION_DENIED` |
| D3 | Tag Size Exhaustion   | Write resource with 50 tags to trigger Denial of Wallet. | `resources/res_345` | `PERMISSION_DENIED` |
| D4 | Anonymous Tampering   | Write resource while signed in anonymously (non-verified email-less account). | `resources/res_456` | `PERMISSION_DENIED` |
| D5 | Immortal Field Hijack  | Update `url` or `userId` of an existing resource. | `resources/res_123` | `PERMISSION_DENIED` |
| D6 | Shadow Field Injection| Insert custom `isSystemGenerated` or `isAdminOwned` field in Resource document. | `resources/res_789` | `PERMISSION_DENIED` |
| D7 | Spoofed Timestamp     | Create resource setting manual `date` timestamp back in 1999 to corrupt stats. | `resources/res_890` | `PERMISSION_DENIED` |
| D8 | Ghost Update          | Change restricted immutable attributes on a document during standard update. | `resources/res_123` | `PERMISSION_DENIED` |
| D9 | PII Scraping          | Attempt to read resources belonging to another user. | `resources/res_999` | `PERMISSION_DENIED` |
| D10| Arbitrary Injection   | Send `category: "HACKED_CATEGORY"`. | `resources/res_111` | `PERMISSION_DENIED` |
| D11| Note Flooding         | Update notes field with 1MB text to cause maximum storage cost. | `resources/res_123` | `PERMISSION_DENIED` |
| D12| Unsigned Delete       | Delete resources belonging to another user. | `resources/res_123` | `PERMISSION_DENIED` |

---

## 3. Security Audit & Mapping Table

| Collection Path | Operation | Access Condition Enforced | Prevention Vector |
|-----------------|-----------|---------------------------|-------------------|
| `resources/{id}` | `get`     | `resource.data.userId == request.auth.uid` | PII leakage and cross-user leaks. |
| `resources/{id}` | `list`    | `resource.data.userId == request.auth.uid` | Massive query scrape prevention. |
| `resources/{id}` | `create`  | `request.auth.uid == incoming().userId && request.auth.token.email_verified == true && isValidResource(incoming())` | Shadow records and size poisoning. |
| `resources/{id}` | `update`  | `request.auth.uid == existing().userId && incoming().userId == existing().userId && isValidResource(incoming())` | Immutability violations, type bypasses. |
| `resources/{id}` | `delete`  | `request.auth.uid == existing().userId` | Malicious deletion of other developer resources. |
