"""Build the graph that a published case shows to the public.

The graph is rebuilt on the server from the case spec (never taken from the browser), then filtered:
  • high-confidence edges (identifier matches) are kept;
  • medium/low-confidence edges are kept only if a reviewer marked them correct;
  • edges a reviewer marked incorrect are always removed;
  • nodes no longer connected to the starting point are dropped.
"""
from collections import deque

from services.accounts import AuthError
from services import identity
from services.graphs import entity_graph


def edge_key(e):
 """Same key the frontend uses for review decisions (tor.js edgeKey)."""
 ev = e.get('evidence')
 seq = ev.get('sequence', '') if isinstance(ev, dict) else ''
 return '|'.join(str(x if x is not None else '') for x in (e['source'], e['type'], e['target'], seq, e.get('item')))


def fingerprint(e):
 ev = e.get('evidence')
 seq = ev.get('sequence', '') if isinstance(ev, dict) else ''
 return (e['source'], e['target'], e['type'], seq, e.get('amount'), e.get('item'))


def build_graph(c, spec, same_person=None):
 graph = entity_graph(c, spec['kind'], spec['key'], spec['branch'], spec['depth'], same_person)
 if not graph: raise AuthError(404, 'สร้างแผนผังจากจุดเริ่มต้นนี้ไม่ได้')
 nodes = {n['id']: n for n in graph['nodes']}
 edges, seen = [], set()
 def add_edges(items):
  for e in items:
   f = fingerprint(e)
   if f not in seen and e['source'] in nodes and e['target'] in nodes: seen.add(f); edges.append(e)
 add_edges(graph['edges'])
 for ref in spec.get('expanded', []):
  sub = entity_graph(c, ref['kind'], ref['key'], spec['branch'], 1, same_person)
  if not sub: continue
  for n in sub['nodes']: nodes.setdefault(n['id'], n)
  add_edges(sub['edges'])
 return graph, nodes, edges


def filter_public(center, nodes, edges, reviews):
 kept, unreviewed, rejected = [], 0, 0
 for e in edges:
  r = reviews.get(edge_key(e))
  if r and r['status'] == 'no': rejected += 1; continue
  if e.get('confidence') in (None, 'high') or (r and r['status'] == 'ok'):
   kept.append({**e, 'review': {'status': r['status'], 'reviewer': r.get('reviewer'), 'at': r.get('at')} if r else None})
  else: unreviewed += 1
 adjacency = {}
 for e in kept:
  adjacency.setdefault(e['source'], set()).add(e['target']); adjacency.setdefault(e['target'], set()).add(e['source'])
 reach, queue = {center}, deque([center])
 while queue:
  for other in adjacency.get(queue.popleft(), ()):
   if other not in reach: reach.add(other); queue.append(other)
 out_nodes = [n for nid, n in nodes.items() if nid in reach]
 out_edges = [e for e in kept if e['source'] in reach and e['target'] in reach]
 stats = {'nodes': len(out_nodes), 'edges': len(out_edges), 'excluded_unreviewed': unreviewed,
          'excluded_rejected': rejected, 'dropped_nodes': len(nodes) - len(out_nodes)}
 return out_nodes, out_edges, stats


def build_snapshot(c, spec, reviews):
 graph, nodes, edges = build_graph(c, spec, identity.confirmed_same_person(reviews))
 center = graph['center_id']
 out_nodes, out_edges, stats = filter_public(center, nodes, edges, reviews)
 return {'scope': graph['scope'], 'center_id': center, 'center_label': nodes[center]['label'], 'spec': spec,
         'nodes': out_nodes, 'edges': out_edges, 'finding': graph.get('finding', ''),
         'coverage': {**graph.get('coverage', {}), 'node_count': stats['nodes'], 'edge_count': stats['edges']},
         'reviews': {edge_key(e): e['review'] for e in out_edges if e['review']}, 'stats': stats}
