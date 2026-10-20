// GET /api/admin/products  (admin) -> the product library, for the blueprint form
import { handler, send } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { productSummaries } from '../../lib/products.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  send(res, 200, { products: productSummaries() });
});
