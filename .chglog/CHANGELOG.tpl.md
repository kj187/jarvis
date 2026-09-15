{{ range .Versions -}}
<a name="{{ .Tag.Name }}"></a>
## {{ if .Tag.Previous }}[{{ .Tag.Name }}]({{ $.Info.RepositoryURL }}/compare/{{ .Tag.Previous.Name }}...{{ .Tag.Name }}){{ else }}{{ .Tag.Name }}{{ end }} ({{ datetime "2006-01-02" .Tag.Date }})

### Breaking Changes

{{ if .NoteGroups -}}
{{ range .NoteGroups -}}
{{ range .Notes -}}
* {{ .Body }}
{{ end -}}
{{ end -}}
{{ else -}}
No breaking changes.
{{ end }}
{{ range .CommitGroups -}}
### {{ .Title }}

{{ range .Commits -}}
* {{ if .Scope }}**{{ .Scope }}:** {{ end }}{{ .Subject }}
{{ end }}
{{ end -}}
{{ end -}}
