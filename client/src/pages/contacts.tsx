import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Users, Mail, Phone, Building2, Linkedin, Search, RefreshCw, AlertCircle, MapPin, Globe, Tag, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Contact } from "@shared/schema";

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  
  const { data: contacts, isLoading, error, refetch } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const handleExport = async (format: 'csv' | 'json') => {
    if (!contacts?.length) {
      toast({ 
        title: "No Data to Export", 
        description: "There are no contacts to export. Import some data first.", 
        variant: "destructive" 
      });
      return;
    }
    
    setIsExporting(true);
    try {
      const response = await fetch(`/api/contacts/export?format=${format}`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (response.status === 401) {
        toast({ 
          title: "Session Expired", 
          description: "Please log in again to export data.", 
          variant: "destructive" 
        });
        return;
      }
      if (response.status === 500) {
        toast({ 
          title: "Server Error", 
          description: "Export failed. Please try again or check server logs.", 
          variant: "destructive" 
        });
        return;
      }
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || `Export failed (${response.status})`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-export.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Export Complete", description: "File downloaded successfully" });
    } catch (error) {
      console.error('Export error:', error);
      toast({ 
        title: "Export Failed", 
        description: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.', 
        variant: "destructive" 
      });
    } finally {
      setIsExporting(false);
    }
  };

  const filteredContacts = contacts?.filter((contact) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      contact.email?.toLowerCase().includes(searchLower) ||
      contact.firstName?.toLowerCase().includes(searchLower) ||
      contact.lastName?.toLowerCase().includes(searchLower) ||
      contact.title?.toLowerCase().includes(searchLower) ||
      contact.companyName?.toLowerCase().includes(searchLower) ||
      contact.website?.toLowerCase().includes(searchLower) ||
      contact.city?.toLowerCase().includes(searchLower) ||
      contact.state?.toLowerCase().includes(searchLower) ||
      contact.category?.toLowerCase().includes(searchLower)
    );
  });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground">View and manage enriched contacts</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-center gap-4 py-6">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div className="flex-1">
                <p className="font-medium">Failed to load contacts</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
              </div>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6 pb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground">
              {contacts?.length || 0} contacts in database
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-contacts"
              />
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => handleExport('csv')}
              disabled={isExporting || !contacts?.length}
              data-testid="button-export-contacts"
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!filteredContacts || filteredContacts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">
                {search ? "No contacts found" : "No contacts yet"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {search
                  ? "Try a different search term"
                  : "Import some data to see contacts here"}
              </p>
              {!search && (
                <Button className="mt-4" asChild>
                  <a href="/" data-testid="link-import">Go to Import</a>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredContacts.map((contact) => (
              <ContactCard key={contact.id} contact={contact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const initials = `${contact.firstName?.[0] || ""}${contact.lastName?.[0] || ""}`.toUpperCase() || 
                   contact.companyName?.[0]?.toUpperCase() || "?";
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || "Unknown";
  const location = [contact.city, contact.state].filter(Boolean).join(", ");

  return (
    <Card className="hover-elevate transition-shadow" data-testid={`card-contact-${contact.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          
          <div className="min-w-0 flex-1">
            <h3 className="font-medium truncate" data-testid={`text-contact-name-${contact.id}`}>
              {fullName}
            </h3>
            
            {contact.title && (
              <p className="text-sm text-muted-foreground truncate">
                {contact.title}
              </p>
            )}

            <div className="mt-2 space-y-1">
              {contact.companyName && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate font-medium" data-testid={`text-company-${contact.id}`}>
                    {contact.companyName}
                  </span>
                </div>
              )}

              {contact.website && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <a 
                    href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                    data-testid={`link-website-${contact.id}`}
                  >
                    {contact.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}

              {contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate text-muted-foreground">{contact.email}</span>
                </div>
              )}
              
              {contact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">{contact.phone}</span>
                </div>
              )}

              {location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground" data-testid={`text-location-${contact.id}`}>
                    {location}
                  </span>
                </div>
              )}

              {contact.category && (
                <div className="flex items-center gap-2 text-sm">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground truncate">{contact.category}</span>
                </div>
              )}

              {contact.linkedinUrl && (
                <div className="flex items-center gap-2 text-sm">
                  <Linkedin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <a 
                    href={contact.linkedinUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                  >
                    LinkedIn Profile
                  </a>
                </div>
              )}
            </div>

            {contact.dataQualityScore && (
              <div className="mt-2">
                <Badge variant="secondary" className="text-xs">
                  Quality: {Number(contact.dataQualityScore).toFixed(0)}%
                </Badge>
              </div>
            )}

            {contact.createdAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Added {formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true })}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
