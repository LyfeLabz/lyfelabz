"""Offline AST extraction: never import or execute the collector's provider code."""
import ast
import copy
import json
import pathlib
import re
import unittest
import urllib.parse

TARGET = pathlib.Path('/private/tmp/lyfelabz-b6b4d-registry-20261027/checkpoint-read.py')
module = ast.parse(TARGET.read_text())
functions = [n for n in module.body if isinstance(n, ast.FunctionDef)
             and n.name in ('registry_lookup', 'registry_agrees')]
assert len(functions) == 2
namespace = {'re': re, 'urllib': urllib}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(TARGET), 'exec'), namespace)
lookup, agrees = namespace['registry_lookup'], namespace['registry_agrees']
fixture = json.loads((pathlib.Path(__file__).parent / 'fixtures/image.json').read_text())

class Mapping(unittest.TestCase):
    def test_provider_mapping_and_encoding(self):
        resource, url = lookup(fixture['uri'])
        self.assertEqual(resource, fixture['name'])
        self.assertEqual(urllib.parse.unquote(url.split('/v1/', 1)[1]), resource)
        self.assertIn('%40sha256%3A', url)
        self.assertNotIn('%2540', url)
        agrees({'status': 200, 'body': fixture}, resource, fixture['uri'])

    def test_nested_package_identity_encoding(self):
        image = package_image('nested/ordinary-package')
        resource, url = lookup(image)
        self.assertEqual(urllib.parse.unquote(url.split('/v1/', 1)[1]), resource)
        self.assertIn('/dockerImages/nested%2F', url)

    def test_validator_and_collector_have_identical_uri_predicates(self):
        validator = (TARGET.parent / 'tools/checkpoint.cjs').read_text()
        line = next(line.strip() for line in validator.splitlines()
                    if 'assert.match(image, /' in line)
        js_pattern = line.split('assert.match(image, /', 1)[1].removesuffix('/);')
        call = next(node for node in ast.walk(functions[0])
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == 'fullmatch')
        self.assertEqual(js_pattern.removeprefix('^').removesuffix('$').replace(r'\/', '/'),
                         ast.literal_eval(call.args[0]))


def package_image(package):
    return ('us-central1-docker.pkg.dev/lyfelabz-staging/gcf-artifacts/'
            + package + '@' + fixture['uri'].split('@')[1])


for package in ['ordinary', 'ordinary-package', 'ordinary_package', 'ordinary.package',
                'a1-b2_c3.d4', 'nested/ordinary-package', 'nested.path/ordinary_package/leaf']:
    def case(self, package=package):
        image = package_image(package)
        resource, url = lookup(image)
        self.assertEqual(urllib.parse.unquote(url.split('/v1/', 1)[1]), resource)
        self.assertEqual(resource.split('/dockerImages/')[1], image.split('/gcf-artifacts/')[1])
        agrees({'status': 200, 'body': {'name': resource, 'uri': image}}, resource, image)
    setattr(Mapping, 'test_original_grammar_accepts_' + package, case)

approved_package = 'lyfelabz--staging__us--central1__option_b_deployment_probe'
for package in [
    'unrelated--package', 'unrelated__package', 'nested/unrelated---package',
    'unrelated___package', 'unrelated..package', 'unrelated._package', 'unrelated-_package',
    'nested--path/ordinary', 'nested__path/ordinary',
    'prefix' + approved_package, approved_package + 'suffix',
    'prefix-' + approved_package, approved_package + '-suffix',
    'nested/' + approved_package, approved_package + '/leaf',
    approved_package.replace('lyfelabz', 'Lyfelabz'), approved_package.replace('__', '%5F%5F'),
    './' + approved_package, approved_package + '/', approved_package + ' ',
]:
    def case(self, package=package):
        image = package_image(package)
        resource = ('projects/lyfelabz-staging/locations/us-central1/repositories/'
                    'gcf-artifacts/dockerImages/' + image.split('/gcf-artifacts/')[1])
        response = {'status': 200, 'body': {'name': resource, 'uri': image}}
        with self.assertRaises(AssertionError):
            actual_resource, _ = lookup(image)
            agrees(response, actual_resource, image)
    setattr(Mapping, 'test_reject_consistent_unauthorized_package_' + package, case)

# Separate tests give each matrix row an independently reported outcome.
name_changes = {
    'wrong_project': ('lyfelabz-staging', 'lyfelabz-prod'),
    'wrong_location': ('us-central1', 'us-east1'),
    'wrong_repository': ('gcf-artifacts', 'other'),
    'wrong_package': ('option_b_deployment_probe', 'other'),
    'wrong_digest': ('5317d171', 'aaaaaaaa'),
    'malformed_resource': ('/dockerImages/', '/packages/'),
    'encoded_digest': ('sha256:', 'sha256%3A'),
    'double_encoded_digest': ('sha256:', 'sha256%253A'),
}
for label, (old, new) in name_changes.items():
    def case(self, old=old, new=new):
        body = copy.deepcopy(fixture)
        body['name'] = body['name'].replace(old, new)
        with self.assertRaises(AssertionError):
            agrees({'status': 200, 'body': body}, fixture['name'], fixture['uri'])
    setattr(Mapping, 'test_reject_' + label, case)

for label, response in {
    'missing': {'status': 200, 'body': {}},
    'ambiguous': {'status': 200, 'body': [fixture, fixture]},
    'unavailable': {'status': 404, 'body': fixture},
    'uri_disagreement': {'status': 200, 'body': dict(fixture, uri=fixture['uri']+'0')},
    'digest_only_legacy_resource': {'status': 200, 'body': dict(
        fixture, name=fixture['name'].split('/dockerImages/')[0]
        + '/dockerImages/' + fixture['uri'].split('@')[1])},
}.items():
    def case(self, response=response):
        with self.assertRaises(AssertionError):
            agrees(response, fixture['name'], fixture['uri'])
    setattr(Mapping, 'test_reject_' + label, case)

for label, image in {
    'uri_project': fixture['uri'].replace('lyfelabz-staging', 'other'),
    'uri_location': fixture['uri'].replace('us-central1', 'us-east1'),
    'uri_repository': fixture['uri'].replace('gcf-artifacts', 'other'),
    'uri_encoding': fixture['uri'].replace('sha256:', 'sha256%3A'),
    'uri_short_digest': fixture['uri'][:-1],
    'uri_uppercase_digest': fixture['uri'].split('@')[0] + '@sha256:' + 'A'*64,
    'uri_long_digest': fixture['uri'] + '0',
    'uri_mutable_tag': fixture['uri'].split('@')[0] + ':version_1',
    'uri_tag_plus_digest': fixture['uri'].replace('@sha256:', ':version_1@sha256:'),
    'uri_empty_segment': fixture['uri'].replace('/gcf-artifacts/', '/gcf-artifacts//'),
    'uri_newline': fixture['uri']+'\n',
    'uri_triple_underscore': fixture['uri'].replace('__', '___'),
}.items():
    def case(self, image=image):
        with self.assertRaises(AssertionError):
            lookup(image)
    setattr(Mapping, 'test_reject_' + label, case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
