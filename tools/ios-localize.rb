# iOS uygulama adını dile göre yerelleştirir: Türkçe "Şahkart", İngilizce "Chromate".
# Kullanım: GEM_HOME=<cocoapods libexec> ruby tools/ios-localize.rb
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' }
app_group = project.main_group['App']
group = app_group.children.find { |c| c.display_name == 'InfoPlist.strings' }
unless group
  group = project.new(Xcodeproj::Project::Object::PBXVariantGroup)
  group.name = 'InfoPlist.strings'
  group.source_tree = '<group>'
  app_group.children << group
  %w[en tr].each do |lang|
    ref = project.new(Xcodeproj::Project::Object::PBXFileReference)
    ref.name = lang
    ref.path = "#{lang}.lproj/InfoPlist.strings"
    ref.source_tree = '<group>'
    ref.last_known_file_type = 'text.plist.strings'
    group.children << ref
  end
  target.resources_build_phase.add_file_reference(group)
end
regions = project.root_object.known_regions
%w[en tr Base].each { |r| regions << r unless regions.include?(r) }
project.save
puts 'ok: ' + project.root_object.known_regions.join(',')
