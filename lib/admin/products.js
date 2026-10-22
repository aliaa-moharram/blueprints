// GET /api/admin/products  (admin) -> the product library, templates, and whether drafting from notes is on
import { handler, send } from '../http.js';
import { requireAdmin } from '../auth.js';
import { productSummaries } from '../products.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  send(res, 200, { products: productSummaries(), drafting: !!process.env.ANTHROPIC_API_KEY });
});
